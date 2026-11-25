-- Read-only storage audit. Run in the Neon SQL Editor against the production
-- database before deciding whether any index or historical data can be removed.

SELECT
    relname AS table_name,
    n_live_tup AS estimated_rows,
    pg_size_pretty(pg_relation_size(relid)) AS table_size,
    pg_size_pretty(pg_indexes_size(relid)) AS index_size,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

SELECT
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan AS scans_since_stats_reset,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;

-- Index scan counts can reset and may not include every workload. Do not drop
-- an index solely because idx_scan is zero in one snapshot.
