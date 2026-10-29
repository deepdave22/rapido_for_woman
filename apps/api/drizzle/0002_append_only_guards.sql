-- Records that must never be rewritten. Corrections are made by inserting new rows.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financial_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON financial_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ride_events_append_only
  BEFORE UPDATE OR DELETE ON ride_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_events_append_only
  BEFORE UPDATE OR DELETE ON incident_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
-- A published price version is immutable; quotes and rides point at it.
CREATE TRIGGER pricing_rules_immutable
  BEFORE UPDATE OR DELETE ON pricing_rules
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
-- Every ledger transaction must balance (debits = credits), checked at commit
-- so a transaction can insert its legs one by one.
CREATE OR REPLACE FUNCTION assert_ledger_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  imbalance bigint;
BEGIN
  SELECT COALESCE(SUM(CASE direction WHEN 'DEBIT' THEN amount_paise ELSE -amount_paise END), 0)
    INTO imbalance
    FROM financial_ledger_entries
   WHERE transaction_id = NEW.transaction_id;
  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'Ledger transaction % is unbalanced by % paise', NEW.transaction_id, imbalance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER financial_ledger_entries_balanced
  AFTER INSERT ON financial_ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_transaction_balanced();
