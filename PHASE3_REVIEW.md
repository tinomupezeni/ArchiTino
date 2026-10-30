# Phase 3 review — HBEC data architecture

Validated on 2026-10-30 against a read-only HBEC workspace. The extension-host test analyzed the development Compose file and its model sources: **79 Python model files, 138 data nodes, and 148 graph edges**. The 138 nodes include three inferred Django many-to-many join tables; the edge total includes their six synthesized foreign-key links. The graph passed structural validation. Selecting the production Compose file also retained build-context ownership and mapped `Payment` to the `payments` service and `hbec_payments` database.

## Reference relationships

The HBEC extension-host test checks 22 declared relationships, their endpoints, relation types, and source-line evidence:

| Service | Checked examples |
| --- | --- |
| Admin | `ExamPaper` to `ExamBoard`, `Subject`, and `AdminUser`; its many-to-many `shared_with_subjects`; `Artifact.release`; `RevisionNote.topic`; `QuizQuestion.quiz` |
| Student | `Paper.exam_board`, `Paper.generated_for`, and `Paper.shared_with_subjects`; the two profile-to-user one-to-one links; `PracticeSession.artifact`; `PaperRating.paper` |
| Payments | `Subscription.user_reference_id`; `Payment.subscription_id`; `PaymentTransactionLog.payment_id` |
| Notifications | `Notification.draft_id`; `TicketEvent.ticket_id` |
| Harness | `Question.paper_id`; self-reference `Question.parent_id`; `LearningGuideMessage.session_id` |

The test also checks that `ContentGapReport.subject_id` and `UserReference.external_user_id` do **not** become foreign-key edges. Those identifiers are not ORM-declared physical foreign keys. A malformed model file fixture verifies that an error becomes a diagnostic while a valid file still renders. Parser tests cover Django string/self targets, many-to-many joins, SQLAlchemy declarative foreign keys, association tables, and `secondary` relationships. A webview test checks service/app scoping, a one-hop model in another app, and the domain-to-physical switch.

## Known gaps

- Four schools-service references to `django.contrib.auth.models.User` remain unresolved: `SchoolAdmin.user`, `Student.user`, `StudentImportJob.uploaded_by`, and `SchoolToken.user`. Django's built-in model definition is outside the workspace, so the extractor reports these references instead of inventing a table node.
- Static parsing cannot determine runtime-generated table names or relations, nor compare source declarations with a live database or applied migrations. Some SQLAlchemy relationships without an explicit resolvable `secondary` target are not shown as direct edges.
- The data and system maps are separate selections. Phase 4 will add a direct path from a service in the system map to its owned data and a diagnostic panel for coverage gaps.

## Verification

`npm run lint`, `npm test`, and `ARCHI_TEST_WORKSPACE=/home/shadowe/Projects/HBEC npm run test:extension` pass. The extension-host run verifies source navigation for a payments relationship. These automated checks cover the Phase 3 exit gate; a regular desktop click-through remains part of the Phase 4 MVP review.
