# Operations runbook

For the on-call engineer and the safety team. Keep it short and current.

## SOS and safety incidents (highest priority)

1. New SOS alerts appear at the top of **Admin → Safety incidents** (the queue refreshes every 10 s).
   **Until paging is integrated, someone must watch this queue 24×7** (LAUNCH_BLOCKERS O1).
2. **Acknowledge** at once. The passenger's app then shows the alert was received.
3. Call the reporter (the number is on the incident page; the view is audited). If there is any
   danger, call 112 on her behalf and stay on the line.
4. **Record response** with what was actually done ("Called passenger, she is safe at …",
   "112 called, reference …"). Only then does her app show that a response is under way. Never
   record a response that has not happened.
5. If needed, **end the ride** (Rides → End ride) and **suspend** the other party pending review.
6. **Resolve** with a summary; **Close** after follow-up.

## Service health

| Symptom                            | Check                                                                | Action                                                                           |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `/health/ready` 503                | Which check failed: database or Redis                                | Managed-service status; failover; scale                                          |
| Many `NO_DRIVER_FOUND`             | Drivers online (overview), zone coverage                             | Operations: driver supply; check location ingest errors                          |
| OTP complaints                     | API logs for `OTP_DELIVERY_FAILED`                                   | SMS provider status, DLT template, credit balance                                |
| Payments stuck `PENDING`           | Webhook delivery in the Razorpay dashboard; `payment_webhook_events` | Check the signature secret, firewall, then replay the webhook from the dashboard |
| `PAYMENT_AMOUNT_MISMATCH` in audit | `audit_logs` entry with expected/received                            | Never edit payments by hand; investigate with finance, then refund or reconcile  |

## Payments and money

- The ledger is append-only. Corrections are new entries via refunds or payouts, never SQL updates.
- Refunds need two different staff members (request, then approve).
- Payout failures automatically return the money to the driver's balance.

## Security incident

1. Contain: disable affected staff accounts (Staff → Disable) and suspend affected users.
   Rotate `JWT_ACCESS_SECRET` to sign everyone out.
2. Preserve evidence: export audit logs and application logs for the period. Do not delete anything.
3. Assess what personal data was involved, and notify as required by the DPDP rules and contracts
   (counsel to define timelines: LAUNCH_BLOCKERS L8).

## Routine

- Daily: incident queue empty or owned; support queue within SLA.
- Weekly: driver documents expiring in the next 30 days. Maintenance takes drivers offline
  automatically when a document expires.
- Quarterly: restore drill (DEPLOYMENT.md), access review of staff roles, dependency upgrades.
