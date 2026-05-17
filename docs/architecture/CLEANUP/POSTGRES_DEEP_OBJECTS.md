# Postgres deep objects (views, triggers, extensions)

Run in Supabase SQL editor (read-only) and archive CSV under `tmp/` if needed.

## Views / materialized views

```sql
select schemaname, viewname from pg_views where schemaname = 'public' order by 1,2;
select schemaname, matviewname from pg_matviews where schemaname = 'public' order by 1,2;
```

## Triggers (per table)

```sql
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
order by 1,2;
```

## Extensions

```sql
select extname, extversion from pg_extension order by 1;
```

## Policy

Mark OCI queue / marketing signal triggers as **IMMUTABLE** in internal docs before any change. Panel-only views may be candidates for deprecation after UI slimdown.
