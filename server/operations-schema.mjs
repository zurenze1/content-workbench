// 只追加工作关系；原账号、素材、脚本、发布和复盘表继续作为真源。
export const OPERATIONS_SCHEMA=`
CREATE TABLE IF NOT EXISTS ip_profiles(account_id TEXT PRIMARY KEY REFERENCES accounts(id),payload TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS opportunities(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES hot_events(id),account_id TEXT NOT NULL REFERENCES accounts(id),payload TEXT NOT NULL DEFAULT '{}',state TEXT NOT NULL DEFAULT '观察中',topic_id TEXT REFERENCES topics(id),revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(event_id,account_id));
CREATE TABLE IF NOT EXISTS productions(topic_id TEXT PRIMARY KEY REFERENCES topics(id),phase TEXT NOT NULL DEFAULT '选题',owner TEXT NOT NULL DEFAULT '',due_at TEXT NOT NULL DEFAULT '',next_action TEXT NOT NULL DEFAULT '',adopted_version_id TEXT REFERENCES script_versions(id),revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approval_rounds(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL REFERENCES topics(id),version_id TEXT NOT NULL REFERENCES script_versions(id),reviewer TEXT NOT NULL,status TEXT NOT NULL DEFAULT '待审',requested_at TEXT NOT NULL,decided_at TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',origin TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS workflow_events(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL REFERENCES topics(id),kind TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS handoffs(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL REFERENCES topics(id),version_id TEXT NOT NULL REFERENCES script_versions(id),approval_id TEXT REFERENCES approval_rounds(id),blob_hash TEXT NOT NULL REFERENCES blobs(hash),filename TEXT NOT NULL,payload TEXT NOT NULL,checksum TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS opportunities_account ON opportunities(account_id,updated_at);
CREATE INDEX IF NOT EXISTS approvals_topic ON approval_rounds(topic_id,requested_at);
CREATE INDEX IF NOT EXISTS workflow_topic ON workflow_events(topic_id,created_at);
CREATE TRIGGER IF NOT EXISTS immutable_workflow_update BEFORE UPDATE ON workflow_events BEGIN SELECT RAISE(ABORT,'流程历史不可修改'); END;
CREATE TRIGGER IF NOT EXISTS immutable_workflow_delete BEFORE DELETE ON workflow_events BEGIN SELECT RAISE(ABORT,'流程历史不可删除'); END;
CREATE TRIGGER IF NOT EXISTS immutable_handoffs_update BEFORE UPDATE ON handoffs BEGIN SELECT RAISE(ABORT,'交付快照不可修改'); END;
CREATE TRIGGER IF NOT EXISTS immutable_handoffs_delete BEFORE DELETE ON handoffs BEGIN SELECT RAISE(ABORT,'交付快照不可删除'); END;
`;
