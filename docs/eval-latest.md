# 評価結果 2026/9/6 17:06:57

- Embedding: text-embedding-3-small / 生成: gpt-5-nano / topK: 5 / 閾値: 0.4
- **Recall@5: 1.00**（該当あり 11 問）
- **該当なし正答: 3/3**
- **RLS 検証: 1/1**
- 閾値の目安: 該当あり問の最低 top スコア = 0.441 / 該当なし問の最高 top スコア = 0.511 → 中間 0.476

| No | 種別 | ユーザー | 判定 | top score | Recall | 上位文書 | 備考 |
|---|---|---|---|---|---|---|---|
| 1 | hit | all_depts | ✅ | 0.517 | 1.00 | strategy-05-dx-roadmap.docx<br>case7-doc1-strategy-dx-bank.pdf<br>strategy-02-midterm-plan.pdf |  |
| 2 | hit | all_depts | ✅ | 0.665 | 1.00 | case7-doc1-strategy-dx-bank.pdf<br>hr-02-personnel-system.pdf<br>admin-01-expense.pdf<br>ops-02-callcenter.pdf |  |
| 3 | hit | hr_only | ✅ | 0.610 | 1.00 | case7-doc2-hr-engagement-report.pdf<br>hr-06-workstyle.docx<br>hr-02-personnel-system.pdf |  |
| 4 | hit | all_depts | ✅ | 0.508 | 1.00 | case7-doc2-hr-engagement-report.pdf<br>hr-04-training.pdf<br>hr-06-workstyle.docx<br>strategy-02-midterm-plan.pdf<br>hr-05-talent.docx |  |
| 5 | hit | all_depts | ✅ | 0.594 | 1.00 | it-05-saas-selection.docx<br>case7-doc3-it-cloud-migration.pdf<br>strategy-06-pricing.docx |  |
| 6 | hit | all_depts | ✅ | 0.549 | 1.00 | case7-doc3-it-cloud-migration.pdf<br>it-02-core-renewal.pdf<br>it-04-data-platform.pdf<br>ops-04-rpa.pdf |  |
| 7 | hit | all_depts | ✅ | 0.718 | 1.00 | case7-doc4-sales-proposal-retail.pdf<br>sales-03-crm.pdf |  |
| 8 | hit | all_depts | ✅ | 0.441 | 1.00 | strategy-06-pricing.docx<br>sales-05-negotiation.docx<br>case7-doc4-sales-proposal-retail.pdf |  |
| 9 | hit | all_depts | ✅ | 0.629 | 1.00 | case7-doc1-strategy-dx-bank.pdf<br>strategy-05-dx-roadmap.docx<br>case7-doc3-it-cloud-migration.pdf<br>it-05-saas-selection.docx |  |
| 10 | no_hit | all_depts | ✅ | 0.511 | - | hr-05-talent.docx<br>hr-03-recruit-branding.pdf<br>hr-02-personnel-system.pdf<br>it-06-insourcing.docx<br>sales-02-sales-process.pdf | 閾値は通過したが LLM が該当なしと判定 |
| 11 | no_hit | all_depts | ✅ | 0.385 | - | hr-06-workstyle.docx<br>case7-doc4-sales-proposal-retail.pdf<br>admin-05-audit.docx<br>ops-02-callcenter.pdf<br>ops-06-quality.docx |  |
| 12 | rls | hr_only | ✅ | 0.376 | - | hr-05-talent.docx<br>hr-02-personnel-system.pdf<br>hr-03-recruit-branding.pdf<br>hr-04-training.pdf | 所属 hr で 5 件 |
| 13 | hit | all_depts | ✅ | 0.661 | 1.00 | ops-01-order-bpr.pdf<br>admin-05-audit.docx<br>admin-04-contract.pdf |  |
| 14 | hit | all_depts | ✅ | 0.599 | 1.00 | admin-01-expense.pdf<br>admin-03-budget.pdf<br>case7-doc1-strategy-dx-bank.pdf |  |
| 15 | no_hit | all_depts | ✅ | 0.485 | - | it-06-insourcing.docx<br>hr-03-recruit-branding.pdf<br>case7-doc1-strategy-dx-bank.pdf<br>strategy-02-midterm-plan.pdf<br>hr-05-talent.docx | 閾値は通過したが LLM が該当なしと判定 |