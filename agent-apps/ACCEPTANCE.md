# Acceptance: criteria against test evidence

Checked on 2026-10-23 by re-running the suites on this machine (no live backend, no Outlook, nothing sent). Every
test named below passed in that run. No real name appears in any test or in this file: tests use synthetic names
and read COPIES of the gitignored reference files only for counts and dates.

Related: [`DECISIONS-AND-ASSUMPTIONS.md`](./DECISIONS-AND-ASSUMPTIONS.md) (what to confirm),
[`FIRST-RUN-GUIDE.md`](./FIRST-RUN-GUIDE.md) (what to check by hand in Excel).

## Result at a glance

| Result | Criteria |
|---|---|
| **Satisfied** | 1 rotation dates, 2 swap Sunday, 4 staffing, 6 PTO import, 7 final changes only approved cells, 8 Task B on the 2026 inputs, 9 package diff, E1 idempotent, E2 audit log, E3 clear errors, E5 master untouched |
| **Satisfied as implemented, wording to confirm** | 3 fairness (the tie rule: see the note under criterion 3) |
| **Partial** | 5 HOL check (Pune exactly proven; strays in the other four locations are flagged, but only an ad-hoc run proves it, no committed test asserts it), E4 formulas recalculated (proven only with two restricted evaluators; no Excel or LibreOffice) |
| **Not satisfied** | none. Not verifiable on this machine: opening any generated file in real Excel (see "What this does not prove") |

## Suites re-run just now

Interpreters: `agent-apps\.venv\Scripts\python.exe` for the library and task suites, `Agents-workspace\.venv\Scripts\python.exe`
for the backend. `-p no:cacheprovider --basetemp=<scratch>` on every run.

| Suite (folder) | Command (from the folder) | Result |
|---|---|---|
| `agent-apps\shared\roster_lib` | `python -m pytest -q -rs` | **689 passed, 0 skipped** (3 min 41 s). The real-file tests (reference roster, real Holiday Roster, real config) are in these and **ran**. |
| `agent-apps\shared\winter_lib` | `python -m pytest -q -rs` | **183 passed, 0 skipped** (3 min 10 s). The real-file tests (real rosters, real configs) **ran**. |
| `agent-apps\shift-roster` | `python -m pytest -q -rs` | **98 passed, 0 skipped** (2 min 51 s). `test_real_smoke.py` **ran** on copies of the real roster, Holiday Roster and config. |
| `agent-apps\december-disconnect` | `python -m pytest -q -rs` | **135 passed, 0 skipped** (6 min 21 s). `test_real_smoke.py` **ran** on copies of the real rosters, Analytics rosters and configs. |
| backend e2e: `agent-office\backend` (not in this repo) | `python -m pytest -q -rs -p no:cacheprovider test_shift_roster_e2e.py test_december_disconnect_e2e.py --no-cov` | **9 passed, 0 skipped** (2 min 57 s): 4 Shift Roster + 5 December Disconnect. |
| backend, whole suite (same folder) | `python -m pytest -q -p no:cacheprovider` | **293 passed**, coverage 92.08% (gate is 80%) (3 min 58 s). Includes `test_platform.py` (124 tests of the platform endpoints and guards). |

The backend e2e files drive the real backend code through FastAPI's TestClient with the task scripts running as real
subprocesses in a temp folder; the live port 8000 is never contacted.

## Criteria

Paths: `R` = `agent-apps/shared/roster_lib/tests/`, `W` = `agent-apps/shared/winter_lib/tests/`,
`S` = `agent-apps/shift-roster/tests/`, `D` = `agent-apps/december-disconnect/tests/`,
`B` = `Agents-workspace/agent-office/backend/`.

### 1. Rotation-date tests: 9 cycle vectors, no hard-coded June 2026 exception. **Satisfied**

| Evidence | Re-run |
|---|---|
| `R test_cycles.py::test_rotation_sunday_vectors` (9 parametrised cases: Aug 2026 to 2026-08-02, Oct 2026 to 2026-10-04, Dec 2026 to 2026-11-29, Feb 2027 to 2027-01-31, Apr 2027 to 2027-04-04, Jun 2027 to 2027-05-30, Aug 2027 to 2027-08-01, Oct 2027 to 2027-10-03, Dec 2027 to 2027-11-28) | yes, 9 passed (full suite) |
| `R test_cycles.py::test_no_legacy_exception_for_june_2026`, `::test_dec_2026_cycle_end` | yes |
| `R test_cycles.py::test_rule_for_every_previous_month_end_weekday` (7 cases: the rule for every weekday the previous month can end on), `::test_leap_year_february_previous_month`, `::test_cycles_tile_for_many_years` | yes |

### 2. Swap-Sunday test reproduces the 2 Aug 2026 patterns. **Satisfied**

| Evidence | Re-run |
|---|---|
| `R test_rotation.py::test_swap_sunday_vectors_no_overlap_no_gap`: S1 to S2 mover worked Fri 31 Jul as S1, off Sat 1 Aug, works Sun 2 Aug as S2, off Mon-Tue, works Wed-Sun; S2 to S1 mover's last S2 day is Sat 1 Aug, off Sun 2 Aug, S1 from Mon 3 Aug; a PERMANENT person continues Mon-Fri; across the boundary never two shifts on a day and never more than 6 days in a row | yes |
| `R test_rotation.py::test_auto_swap_flips_and_pattern_follows_new_code`, `::test_auto_swap_with_wed_sun_exception_s1_goes_to_s2_wed_sun_then_back_to_mon_fri`, `::test_auto_swap_follows_the_observed_shift_not_the_listed_pair` | yes |
| `R test_cycle_builder.py::test_normal_cycle_scope_and_swap_sunday`, `::test_year_boundary_swap_sunday_and_patterns_continue` | yes |

### 3. Fairness test (most offs cover; the fewest get the next off; ties). **Satisfied as implemented; confirm the tie wording**

| Evidence | Re-run |
|---|---|
| `R test_holiday_engine.py::test_fewest_offs_gets_the_next_off`: A has 4 offs, B has 3, so B gets the off and A covers (counters 4/4 afterwards) | yes |
| `R test_holiday_engine.py::test_tie_on_count_the_most_recent_off_covers`: equal counts, the person who was off most recently covers, so the other gets the off; a never-off person counts as the oldest | yes |
| `R test_holiday_engine.py::test_seeded_tie_break_is_reproducible_and_seed_dependent`, `::test_result_does_not_depend_on_people_order`, `::test_counters_carry_across_holidays_in_date_order`, `::test_team_level_fewest_offs_order_applies_across_shifts` | yes |
| `R test_cycle_builder.py::test_holiday_assignment_and_fairness` | yes |

Note: the spec sentence "ties give the off to whoever took an off most recently" can be read two ways. The build
implements: on a tie, the person who was **off most recently covers** (so the person whose last off is the oldest gets
this off). That is what the tests assert. If you meant the opposite (the most recent off gets the next off too), it
is a one-line change in the ordering of `holiday_engine.py`; say so.

### 4. Staffing test: minimum 3 for DIS, DEP, L3 per shift; "Option B" for the other teams. **Satisfied**

| Evidence | Re-run |
|---|---|
| `R test_config.py::test_min_staff_for`, `::test_min_staff_for_team_uses_aliases_and_defaults`, `::test_min_staff_mode_defaults_aliases_and_overrides` (DIS, DEP, L3 `per_shift` with 3; every other team `per_team_day` with 2), `::test_min_staff_mode_validation`, `::test_min_staff_zero_override_means_no_minimum` | yes |
| `R test_checks.py::test_per_team_day_counts_the_team_across_shifts`, `::test_per_team_day_single_person_team_never_gets_an_impossible_shortage` (capped at the members scheduled), `::test_per_team_day_small_team_on_offset_patterns`, `::test_per_team_day_a_day_nobody_is_scheduled_is_not_active`, `::test_per_team_day_counts_custom_hours_and_mexico_but_not_blank` | yes |
| `R test_holiday_engine.py::test_minimum_staffing_by_team` (5 cases), `::test_team_level_fairness_group_spans_all_shifts`, `::test_team_level_small_team_on_offset_patterns_uses_those_scheduled_that_day` | yes |
| Shortages are flagged and never auto-fixed: `R test_holiday_engine.py::test_group_at_or_below_minimum_nobody_off_and_flagged`, `::test_location_specific_shortage_is_flagged_never_fixed`, `::test_staffing_check_after_engine_matches_the_flags`; `R test_cycle_builder.py::test_per_team_day_headcount_flags_and_table`, `::test_per_team_day_removes_the_phantom_shortages_of_small_teams`, `::test_per_team_day_leave_below_the_effective_minimum_flags_staffing_and_pto`, `::test_per_team_day_holiday_group_is_the_whole_team` | yes |
| `R test_pto.py::test_below_minimum_per_team_day_counts_all_shifts_with_the_effective_minimum`, `::test_below_minimum_per_team_day_single_person_and_offset_patterns` | yes |

### 5. HOL check finds the stray HOLs on the 2026 roster. **Partial**

| Evidence | Re-run |
|---|---|
| The seven Pune strays (23 Jun, 9 Jul, 18 Aug, 13 Oct, 29 Oct, 8 Dec, 24 Dec): `R test_checks.py::test_real_roster_pune_strays_include_the_seven_known_dates` (real roster, matrix derived from its label row) | yes, ran (not skipped) |
| With the real Holiday Roster: the Pune strays are **exactly eleven dates** (the seven plus 28 Apr, 29 Apr, 14 May, 3 Sep) and all belong to Pune people: `R test_checks.py::test_real_roster_pune_strays_are_exactly_the_eleven_known_dates_with_the_real_matrix` | yes, ran |
| Real Holiday Roster loads with 7 Common, 11 location-specific and 7 Mexico-only rows and 11 holidays per India location in 2026: `R test_checks.py::test_real_matrix_loads_with_the_expected_types_and_location_counts` | yes, ran |
| Synthetic equivalents and the rule itself: `R test_checks.py::test_synthetic_pune_strays_have_the_real_files_shape`, `::test_stray_hol_where_location_not_ticked`, `::test_stray_wins_over_weekly_off_on_the_same_cell`, `::test_mexico_hol_stray_when_mexico_not_ticked`; flags: `R test_cycle_builder.py::test_existing_roster_findings_for_the_cycle_year`, `::test_preserved_stray_hol_is_kept_flagged_and_not_counted` | yes |
| Strays in the other locations stay flagged and are never fixed | **only an ad-hoc run**: against the real roster and Holiday Roster the check also reports HOL on non-ticked days for Bengaluru (13 dates), Mexico (10), Gurgaon (4) and Hyderabad (1). Counts only; no committed test asserts them. |

Gap: no committed test pins the strays of the non-Pune locations. They are reported by the same code (the Pune test
also proves the kind and location are right), and they are open item (f) for your review. Say if you want a counts-only
real-file test added.

### 6. PTO import writes codes only on working days, keeps P on holidays, never replaces anyone. **Satisfied**

| Evidence | Re-run |
|---|---|
| Only on working days: `R test_pto.py::test_pto_only_on_working_days_never_weekly_offs` (Mon-Fri and Wed-Sun patterns, weekend stays untouched), `R test_cycle_builder.py::test_edits_only_write_leave_on_working_days` | yes |
| P beats HOL and is kept; other leave stays: `R test_pto.py::test_pto_overwrites_hol_but_not_other_leave_and_range_over_weekend`, `::test_preserved_cells_keep_their_leave_even_a_hol_and_add_a_note`; `R test_cycle_builder.py::test_pto_wins_over_hol_and_is_not_counted`; `R test_holiday_engine.py::test_pto_beats_hol_and_is_not_counted` | yes |
| Never replaces anyone: PTO only edits the person's own working cells (`test_pto_only_on_working_days_never_weekly_offs` asserts every edit replaces a working cell of that person); clashes (swap Sunday, needed, below minimum, overlap) are reported, not resolved: `R test_pto.py::test_clash_on_swap_sunday_and_needed`, `::test_below_minimum_clash`, `::test_overlapping_entries_with_different_codes`. There is no replacement logic in the code. | yes |
| Name matching never silent for close names: `R test_pto.py::test_fuzzy_needs_confirmation_never_silent`, `::test_uncertain_names_skipped_until_confirmed`; `S test_analyze.py::test_form_fields_for_ask_me_new_person_and_pto` | yes |

(No dedicated test is named "no replacements": it holds by construction and is asserted through the edits and clash
tests above.)

### 7. The final build changes ONLY the approved cells. **Satisfied**

| Evidence | Re-run |
|---|---|
| `R test_final_build.py::test_only_approved_cells_change_cell_level_and_package_level`, `::test_noop_edits_skipped`, `::test_verification_failure_removes_everything`, `::test_refuses_when_not_confirmed`, `::test_refuses_when_snapshot_tampered`, `::test_refuses_when_saved_draft_changed_after_the_diff`, `::test_works_on_an_excel_resaved_draft` | yes |
| `S test_finalize.py::test_final_roster_changes_only_the_approved_cells` | yes |
| Real roster: `R test_draft_real.py::test_real_file_final_smoke` (structure and counts) | yes, ran |
| Through the backend: `B test_shift_roster_e2e.py::test_full_lifecycle` (master hash unchanged; package level only the roster sheet part differs; cell level exactly the cells where the edited draft differs from the master) | yes (9 e2e tests passed) |
| December Disconnect: finals are byte copies of the confirmed drafts: `D test_finalize.py::test_final_files_are_byte_copies_of_the_confirmed_drafts`, `::test_refuses_a_draft_changed_after_the_comparison` | yes |

### 8. Task B on the 2026 inputs. **Satisfied**

DIS and DEP at least 2 every day, CMS 2.0, LNS 2.0 and Integration HUB at least 1, every person 3-5 days, and the
Analytics plan fills 34 of 34 slots with every rule check passing.

| Evidence | Re-run |
|---|---|
| `W test_winter_real_files.py::test_real_plan_meets_every_rule` (real inputs: 8-day window, DIS/DEP minimum >= 2, CMS/LNS/HUB >= 1, every person 3-5 days, best-effort teams <= 3, solver succeeded with no fallback and no time limit, no error findings, extra days only for required teams) | yes, ran |
| `W test_winter_real_files.py::test_real_workbook_audit_and_formulas`, `::test_real_run_is_deterministic`, `::test_real_inputs_counts` | yes, ran |
| `W test_analytics_real_files.py::test_real_plan_fills_34_of_34_with_every_rule_passing`, `::test_real_rosters_give_the_team_and_a_usual_shift_each` | yes, ran |
| Whole task on copies of the real files: `D test_real_smoke.py::test_real_files_prepare_analyze_build_draft_and_diff` (one enabled window, 34 of 34 Analytics slots, zero audit errors, days histogram within 3-5, no edit gives no changes and nothing blocking, log lines hold counts only) | yes, ran (135 passed in the suite) |
| Synthetic versions of the same rules: `W test_analytics_plan.py::test_plan_fills_all_34_slots_and_meets_every_hard_rule`; `D test_build_draft.py::test_the_plans_meet_the_rules` | yes |

Known property (open item e): the minimum is always met, but the headcount above the minimum is not evened out
across days (no balance term).

### 9. Package-diff test passes: no comments, labels or hidden sheets lost. **Satisfied**

| Evidence | Re-run |
|---|---|
| `R test_xlsx_patch.py::test_patch_only_target_sheet_part_changes`, `::test_sensitive_parts_survive_byte_identical` (threaded comments, persons, legacy comments, sensitivity label, custom properties, customXml, drawing, calcChain, rels, workbook.xml, shared strings, styles, content types, the hidden second sheet), `::test_non_cell_sheet_elements_byte_identical` (conditional formatting, data validation, hyperlinks, merges, extLst), `::test_zip_entries_order_compression_and_metadata_preserved`, `::test_untouched_cells_and_rows_canonically_unchanged` | yes |
| `R test_pkgdiff.py` (8 tests: identical, changed/added/removed, re-serialised vs real change, strict order and compression, sheet-xml diff incl. conditional-format tamper) | yes |
| `R test_next_year_file.py::test_only_sheet_and_workbook_parts_change_and_features_survive` | yes |
| Draft sheets added at package level: `R test_xlsx_sheets.py::test_only_expected_parts_change`, `::test_existing_parts_survive_byte_identical`, `::test_existing_features_survive`, `::test_styles_append_only` | yes |
| Real roster: `R test_xlsx_patch.py::test_huge_conditional_format_section_is_not_parsed`, `R test_draft_real.py` (3 smoke tests) | yes, ran |

### Spec extras

| # | Requirement | Status | Evidence (all re-run) |
|---|---|---|---|
| E1 | Idempotent and re-runnable | **Satisfied** | `R test_xlsx_patch.py::test_idempotent_and_noop_when_values_already_present`; `S test_build_draft.py::test_same_inputs_give_the_same_output`; `S test_pipeline.py::test_two_complete_runs_give_the_same_files`; `S test_finalize.py::test_rerun_after_a_crash_before_the_config_was_saved_reuses_the_final`; `R test_final_build.py::test_rerun_same_inputs_identical_final_and_append_only_audit`; `D test_pipeline.py::test_two_complete_runs_give_the_same_files`; `D test_finalize.py::test_running_finalize_again_is_idempotent`; `D test_pipeline.py::test_reject_and_rerun_loop`; `D test_build_draft.py::test_a_rerun_archives_the_edited_draft_and_keeps_the_plan_stable`. By design a finished Shift Roster run cannot be finalized twice (the config changed): `S test_finalize.py::test_a_finished_run_cannot_be_finalized_again`. |
| E2 | Audit log | **Satisfied** | `R test_audit.py` (7 tests, append-only), `R test_final_build.py::test_audit_entry_and_log`, `::test_approver_defaults_to_the_os_user`; `S test_finalize.py::test_backup_and_audit_log`; `D test_finalize.py::test_audit_entry_follows_the_roster_lib_conventions`; approver stamp in the run history for every task: `B test_shift_roster_e2e.py::test_full_lifecycle` (approvals with user and time), `B test_platform.py` (approve refused at a form gate with pending fields records no approval, and the other platform guards) |
| E3 | Clear errors (one readable line, no person named) | **Satisfied** | `S test_analyze.py::test_failure_modes_give_one_readable_line`, `S test_common.py::test_run_script_maps_failures_to_exit_codes`, `::test_load_helpers_report_readable_problems`, `S test_build_draft.py::test_incomplete_answers_stop_the_step`, `::test_an_input_changed_after_the_analysis_is_refused`; `D test_analyze.py::test_no_error_message_names_a_person`, `D test_finalize.py::test_error_messages_never_name_a_person`, `D test_build_draft.py::test_missing_and_incomplete_answers_are_refused_without_names`, `D test_pipeline.py::test_manifest_scripts_run_headless_in_order_and_log_no_names`; both manifests: `S`/`D test_manifest.py` |
| E4 | Formulas recalculate with zero errors and cached values equal recalculated | **Partial** | `W test_winter_workbook.py::test_every_formula_recalculates_with_zero_errors_and_matches_the_cached_values`; `W test_analytics_workbook.py::test_formulas_have_zero_errors_and_cached_values_equal_recalculated`, `::test_edits_in_the_workbook_flow_through_the_formulas`, `::test_by_person_counts_and_rule_check_are_formula_driven`; `W test_winter_real_files.py::test_real_workbook_audit_and_formulas` (more than 700 formula cells on the real build); evaluators: `W test_formula_eval.py`, `W test_analytics_formula_eval.py`. **Gap:** this is proven only with two restricted evaluators written for the functions used (no Excel and no LibreOffice on this machine); they show the formulas are consistent under those semantics, not that Excel agrees. The next-year file and the roster drafts rely on Excel recalculating on open (`fullCalcOnLoad`), which cannot be tested here (`R test_next_year_file.py::test_cached_values_updated_and_calc_on_load` checks the flag and cached values only). |
| E5 | Master never modified before the final confirm | **Satisfied** | `R test_final_build.py::test_master_untouched_and_nothing_else_in_master_folder`; `S test_build_draft.py::test_draft_workbook_matches_the_plan_and_the_master_is_untouched`; `D test_build_draft.py::test_real_configs_and_inputs_are_never_written`, `D test_diff_draft.py::test_the_drafts_are_only_read`; `D test_manifest.py::test_input_output_and_config_folders_are_gitignored`; through the backend `B test_shift_roster_e2e.py::test_full_lifecycle` and `B test_december_disconnect_e2e.py::test_full_lifecycle` (hash of the master and the yearly configs compared before and after) |

Platform behavior (uploads, the questions gate, the blocking diff, traversal and junction refusals, the approver stamp)
is covered by the backend tests `B test_shift_roster_e2e.py` (3 more tests: tampered snapshot blocks send and a changed
draft fails finalize, inputs negative and path traversal, output-folder junction refused),
`B test_december_disconnect_e2e.py` (4 more tests, including a run without the optional Analytics rosters, rule-breaking
edits blocking send, a tampered snapshot, missing files) and `B test_platform.py`.

## What this does not prove

* **Nothing was opened in real Excel or LibreOffice.** The drafts, finals and the next-year file pass the package-level
  and cell-level checks, openpyxl loading and the text readers, but a repair prompt, a colour or a dropdown that does not
  render, or a formula that Excel computes differently cannot be ruled out. The first-run guide section 4 is the manual
  test.
* The Tasks app was not driven against a live backend with these two tasks (the live backend also sends real mail, so
  nothing mutating was triggered). The lifecycle is covered by the TestClient e2e tests above and the UI by its own tests.
* Real-file tests read copies of the reference files; if those files are replaced by next year's, the date and count
  assertions in them will need updating (they are tied to the 2026 roster).
