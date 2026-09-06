# 評価結果 2026/9/6 17:47:40

- Embedding: text-embedding-3-small / 生成: gpt-5-nano / topK: 8 / 閾値: 0.4
- **Recall@5: 1.00**（該当あり 11 問）
- **該当なし正答: 3/3**
- **RLS 検証: 1/1**
- 閾値の目安: 該当あり問の最低 top スコア = 0.465 / 該当なし問の最高 top スコア = 0.512 → 中間 0.488

| No | 種別 | ユーザー | 判定 | top score | Recall | 上位文書 | 備考 |
|---|---|---|---|---|---|---|---|
| 1 | hit | all_depts | ✅ | 0.656 | 1.00 | case7-doc1-strategy-dx-bank.pdf<br>strategy-05-dx-roadmap.docx |  |
| 2 | hit | all_depts | ✅ | 0.625 | 1.00 | case7-doc1-strategy-dx-bank.pdf<br>admin-01-expense.pdf<br>hr-02-personnel-system.pdf<br>it-06-insourcing.docx<br>ops-02-callcenter.pdf<br>admin-03-budget.pdf |  |
| 3 | hit | hr_only | ✅ | 0.639 | 1.00 | case7-doc2-hr-engagement-report.pdf<br>hr-06-workstyle.docx<br>hr-02-personnel-system.pdf |  |
| 4 | hit | all_depts | ✅ | 0.465 | 1.00 | case7-doc2-hr-engagement-report.pdf<br>hr-04-training.pdf<br>hr-05-talent.docx<br>strategy-02-midterm-plan.pdf<br>hr-06-workstyle.docx<br>hr-02-personnel-system.pdf |  |
| 5 | hit | all_depts | ✅ | 0.658 | 1.00 | case7-doc3-it-cloud-migration.pdf<br>it-05-saas-selection.docx<br>strategy-06-pricing.docx<br>sales-06-ec.docx<br>it-06-insourcing.docx |  |
| 6 | hit | all_depts | ✅ | 0.597 | 1.00 | case7-doc3-it-cloud-migration.pdf<br>it-02-core-renewal.pdf<br>it-04-data-platform.pdf<br>it-05-saas-selection.docx |  |
| 7 | hit | all_depts | ✅ | 0.683 | 1.00 | case7-doc4-sales-proposal-retail.pdf<br>sales-06-ec.docx<br>admin-03-budget.pdf<br>sales-04-channel.pdf |  |
| 8 | hit | all_depts | ✅ | 0.485 | 1.00 | strategy-06-pricing.docx<br>case7-doc4-sales-proposal-retail.pdf<br>sales-05-negotiation.docx<br>admin-03-budget.pdf |  |
| 9 | hit | all_depts | ✅ | 0.671 | 1.00 | case7-doc1-strategy-dx-bank.pdf<br>case7-doc3-it-cloud-migration.pdf |  |
| 10 | no_hit | all_depts | ✅ | 0.512 | - | hr-03-recruit-branding.pdf<br>it-02-core-renewal.pdf<br>sales-02-sales-process.pdf<br>hr-05-talent.docx<br>hr-02-personnel-system.pdf<br>strategy-05-dx-roadmap.docx<br>it-06-insourcing.docx<br>ops-01-order-bpr.pdf | 閾値は通過したが LLM が該当なしと判定 |
| 11 | no_hit | all_depts | ✅ | 0.380 | - | hr-06-workstyle.docx<br>case7-doc4-sales-proposal-retail.pdf<br>ops-02-callcenter.pdf<br>admin-05-audit.docx<br>hr-05-talent.docx<br>ops-03-inventory.pdf<br>it-06-insourcing.docx<br>hr-03-recruit-branding.pdf |  |
| 12 | rls | hr_only | ✅ | 0.313 | - | hr-02-personnel-system.pdf<br>hr-03-recruit-branding.pdf<br>hr-05-talent.docx<br>hr-06-workstyle.docx<br>hr-04-training.pdf<br>case7-doc2-hr-engagement-report.pdf | 所属 hr で 8 件 |
| 13 | hit | all_depts | ✅ | 0.626 | 1.00 | ops-01-order-bpr.pdf<br>admin-05-audit.docx<br>admin-01-expense.pdf<br>it-06-insourcing.docx<br>case7-doc1-strategy-dx-bank.pdf |  |
| 14 | hit | all_depts | ✅ | 0.674 | 1.00 | admin-01-expense.pdf<br>admin-03-budget.pdf<br>ops-05-procurement.docx |  |
| 15 | no_hit | all_depts | ✅ | 0.479 | - | hr-03-recruit-branding.pdf<br>it-06-insourcing.docx<br>strategy-02-midterm-plan.pdf<br>case7-doc1-strategy-dx-bank.pdf<br>sales-02-sales-process.pdf<br>hr-05-talent.docx | 閾値は通過したが LLM が該当なしと判定 |