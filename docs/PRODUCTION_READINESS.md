# Production readiness

Measured against the Definition of Done for a controlled pilot. Status reflects what has been
built **and verified**. Being written is not enough.

| Criterion                                                           | Status         | Evidence / what is missing                                                                                                                               |
| ------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A passenger can register and request a ride                         | ✅ API, 🟡 app | Integration tests cover OTP → terms → quote → book. Store build configuration done (MOBILE_RELEASE.md); no native build or device run yet.               |
| Only eligible, approved drivers can accept rides                    | ✅             | Eligibility rule (checks, documents, expiry, vehicle) at go-online and in the dispatch query. Maintenance takes newly ineligible drivers offline. Tests. |
| Matching works under concurrent requests                            | ✅             | 60 concurrent bookings → 60 distinct drivers (load test). Concurrent-accept test. Database partial unique indexes.                                       |
| Pickup and trip transitions validated by the backend                | ✅             | Domain state machine, PIN with attempt limit, geofenced arrival, database check constraints. Tests.                                                      |
| Real-time tracking with appropriate permissions                     | ✅ API, 🟡 app | Authenticated Socket.IO; location only to the assigned passenger (tested). App wiring is not device-tested; driver background location built, untested.  |
| Fares calculated server-side                                        | ✅             | Domain fare engine; client-sent amounts are rejected (test).                                                                                             |
| Payment results verified and reconciled                             | 🟡             | Signed webhooks, de-duplication and amount checks (tests). Razorpay has not been called live. In-app checkout UI is missing.                             |
| Driver earnings auditable                                           | ✅             | Double-entry append-only ledger, balance enforced at commit, earnings and payouts derived from it. Tests.                                                |
| SOS tested with a real operational response process                 | ❌             | Software workflow complete and tested. **No staffed 24×7 team, no paging, no SMS provider** (O1, O2).                                                    |
| Admin can manage drivers, rides, support, safety                    | ✅             | Admin API (tests) and dashboard (built; login path verified live).                                                                                       |
| Unauthorised data access prevented and tested                       | ✅             | Object-level, role and app checks; tests for cross-user access throughout.                                                                               |
| Automated tests pass in CI                                          | 🟡             | All pass locally (unit 72, integration 89, perf 5). The Phase 1-2 CI run passed on GitHub; later runs are pending the push.                              |
| Staging, backups, monitoring, recovery verified                     | 🟡             | Production images verified locally; restore drill done locally. **No staging environment, monitoring or alerting yet.**                                  |
| Legal, transport, insurance, privacy, payment, eligibility reviewed | ❌             | Not started: requires counsel (LAUNCH_BLOCKERS L1-L9).                                                                                                   |
| Production credentials and integrations configured                  | ❌             | SMS, maps (live), S3, Razorpay (live), push: accounts not created (EXTERNAL SERVICES).                                                                   |
| Limitations and launch blockers documented                          | ✅             | LAUNCH_BLOCKERS.md, this file, TASKS.md.                                                                                                                 |

## The shortest path to a pilot

1. Legal answers for L1-L3 (is the model lawful; how eligibility may be checked). Everything else depends on these.
2. Accounts: DLT SMS provider, Google Maps Platform, Razorpay merchant, AWS (or similar) in Mumbai, Apple and Google developer accounts.
3. Engineering: SMS adapter, S3 adapter, in-app Razorpay checkout, background location for drivers,
   push notifications, SOS paging, Socket.IO Redis adapter, error tracking.
4. Staging on real infrastructure; sustained load test; external penetration test.
5. Device testing of both apps on low-end Android phones common among drivers.
6. A staffed safety desk with written procedures (RUNBOOK.md) and a rehearsed SOS drill.
