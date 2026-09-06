insert into departments (id, name_ja) values
  ('strategy',   '戦略'),
  ('operations', '業務'),
  ('it',         'IT'),
  ('hr',         '人事'),
  ('sales',      '営業'),
  ('admin',      '管理')
on conflict (id) do update set name_ja = excluded.name_ja;
