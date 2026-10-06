-- Migration 002: Add CHECK constraints to transactions table for amount and status integrity
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_transactions_amount_minor_positive'
    ) THEN
        ALTER TABLE transactions 
        ADD CONSTRAINT chk_transactions_amount_minor_positive CHECK (amount_minor > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_transactions_status_valid'
    ) THEN
        ALTER TABLE transactions 
        ADD CONSTRAINT chk_transactions_status_valid CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED'));
    END IF;
END $$;
