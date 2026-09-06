/**
 * 月次の監査レポート（部署別）を作り、部署管理者に Slack DM で送る。
 *   npm run report                      → 先月分
 *   npm run report -- --month 2026-09   → 指定月
 *   npm run report -- --no-slack        → ファイル出力のみ（eval/reports/YYYY-MM.md）
 * 送付先は department_managers テーブル（data/master/department_managers.csv → npm run db:seed-managers）。
 * GitHub Actions（.github/workflows/monthly-report.yml）が毎月 1 日に自動実行する。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { WebClient } from "@slack/web-api";
import { config, DEPARTMENT_NAME_JA, type DepartmentId } from "../config.js";
import { ingestSql, closeAll } from "../db/client.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function monthRange(ym?: string): { label: string; from: Date; to: Date } {
  const now = new Date();
  const [y, m] = ym ? ym.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth()]; // 既定は先月
  const from = new Date(Date.UTC(ym ? y : y, ym ? m - 1 : m - 1, 1));
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return { label: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`, from, to };
}

interface Row {
  department_id: DepartmentId;
  questions: number;
  users: number;
  answered: number;
  no_hit: number;
  unregistered: number;
  errors: number;
  redacted: number;
  avg_ms: number | null;
}

async function main() {
  const { label, from, to } = monthRange(arg("--month"));
  const noSlack = process.argv.includes("--no-slack");
  const sql = ingestSql();

  // 質問者の所属部署ごとに集計（複数部署所属の人は各部署に数える）
  const rows = await sql<Row[]>`
    select d.id as department_id,
           count(l.id)::int as questions,
           count(distinct l.slack_user_id)::int as users,
           count(*) filter (where l.result_status = 'answered')::int as answered,
           count(*) filter (where l.result_status = 'no_hit')::int as no_hit,
           count(*) filter (where l.result_status = 'unregistered')::int as unregistered,
           count(*) filter (where l.result_status = 'error')::int as errors,
           count(*) filter (where l.redacted_at is not null)::int as redacted,
           round(avg(l.latency_ms))::int as avg_ms
    from departments d
    left join user_departments u on u.department_id = d.id
    left join search_logs l on l.slack_user_id = u.slack_user_id and l.created_at >= ${from} and l.created_at < ${to}
    group by d.id order by d.id`;

  const topQuestions = await sql<{ department_id: string; question: string; n: number }[]>`
    select u.department_id, l.question, count(*)::int as n
    from search_logs l join user_departments u on u.slack_user_id = l.slack_user_id
    where l.created_at >= ${from} and l.created_at < ${to}
    group by u.department_id, l.question order by n desc, l.question limit 100`;

  const redactions = await sql<{ title: string; reason: string; affected_logs: number; created_at: Date }[]>`
    select title, reason, affected_logs, created_at from redactions where created_at >= ${from} and created_at < ${to} order by created_at`;

  const managers = await sql<{ department_id: DepartmentId; slack_user_id: string; display_name: string | null }[]>`
    select department_id, slack_user_id, display_name from department_managers order by department_id`;

  // ---- Markdown（全体） ----
  const lines: string[] = [`# 監査レポート ${label}`, "", `| 部署 | 質問数 | 利用者数 | 回答 | 該当なし | 未登録 | エラー | 取り消し対象 | 平均応答 ms |`, `|---|---|---|---|---|---|---|---|---|`];
  for (const r of rows) {
    lines.push(`| ${DEPARTMENT_NAME_JA[r.department_id] ?? r.department_id} | ${r.questions} | ${r.users} | ${r.answered} | ${r.no_hit} | ${r.unregistered} | ${r.errors} | ${r.redacted} | ${r.avg_ms ?? "-"} |`);
  }
  lines.push("", "## 取り消し（redact）の記録", "");
  lines.push(redactions.length === 0 ? "なし" : redactions.map((x) => `- ${x.created_at.toISOString().slice(0, 10)} 「${x.title}」 理由: ${x.reason}（影響ログ ${x.affected_logs} 件）`).join("\n"));
  const md = lines.join("\n");
  await mkdir("eval/reports", { recursive: true });
  await writeFile(`eval/reports/${label}.md`, md, "utf8");
  console.log(md);
  console.log(`\n保存: eval/reports/${label}.md`);

  // ---- 部署管理者へ Slack DM ----
  if (noSlack) return;
  if (managers.length === 0) {
    console.log("department_managers が空のため Slack 送付はスキップ（data/master/department_managers.csv → npm run db:seed-managers）");
    return;
  }
  const slack = new WebClient(config.slack.botToken);
  let sent = 0;
  for (const m of managers) {
    const r = rows.find((x) => x.department_id === m.department_id);
    const name = DEPARTMENT_NAME_JA[m.department_id] ?? m.department_id;
    const tops = topQuestions.filter((q) => q.department_id === m.department_id).slice(0, 5);
    const text = [
      `*${label} 監査レポート（${name}）*`,
      r ? `質問 ${r.questions} 件 / 利用者 ${r.users} 名 / 回答 ${r.answered} / 該当なし ${r.no_hit} / 未登録 ${r.unregistered} / 取り消し対象 ${r.redacted} / 平均応答 ${r.avg_ms ?? "-"} ms` : "データなし",
      tops.length ? `よく聞かれた質問:\n${tops.map((q) => `• ${q.question}（${q.n} 回）`).join("\n")}` : "",
      redactions.length ? `今月の取り消し: ${redactions.length} 件` : "",
      "詳細（誰が・いつ・何を）は Supabase の search_logs を参照してください。",
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      const dm = await slack.conversations.open({ users: m.slack_user_id });
      if (dm.channel?.id) {
        await slack.chat.postMessage({ channel: dm.channel.id, text });
        sent++;
      }
    } catch (e) {
      console.error(`送付失敗 ${m.slack_user_id}: ${(e as Error).message}`);
    }
  }
  console.log(`Slack DM 送付: ${sent} / ${managers.length} 名`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeAll);
