CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`system_key` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_org_code` ON `accounts` (`org_id`,`code`);--> statement-breakpoint
CREATE INDEX `account_org_key` ON `accounts` (`org_id`,`system_key`);--> statement-breakpoint
CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`actor_id` integer,
	`module` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_org_time` ON `activity_log` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_entity` ON `activity_log` (`org_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`department_id` integer,
	`expires_on` text,
	`created_by` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `announcements_org` ON `announcements` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`tag` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'Laptop' NOT NULL,
	`serial_number` text,
	`purchase_date` text,
	`cost` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`assigned_to` integer,
	`assigned_at` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_to`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_org_tag` ON `assets` (`org_id`,`tag`);--> statement-breakpoint
CREATE TABLE `attendance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`check_in` text,
	`check_out` text,
	`late_minutes` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`note` text,
	`leave_request_id` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_emp_date` ON `attendance` (`employee_id`,`date`);--> statement-breakpoint
CREATE INDEX `attendance_org_date` ON `attendance` (`org_id`,`date`);--> statement-breakpoint
CREATE TABLE `attendance_regularizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`check_in` text,
	`check_out` text,
	`status` text DEFAULT 'present' NOT NULL,
	`reason` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`decided_by` integer,
	`decided_at` integer,
	`decision_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `regularization_emp` ON `attendance_regularizations` (`employee_id`);--> statement-breakpoint
CREATE INDEX `regularization_org_state` ON `attendance_regularizations` (`org_id`,`state`);--> statement-breakpoint
CREATE TABLE `bank_statement_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`reference` text,
	`amount` integer DEFAULT 0 NOT NULL,
	`journal_entry_id` integer,
	`status` text DEFAULT 'unmatched' NOT NULL,
	`import_batch` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bank_lines_org` ON `bank_statement_lines` (`org_id`,`status`);--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`job_id` integer NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`source` text DEFAULT 'other' NOT NULL,
	`stage` text DEFAULT 'applied' NOT NULL,
	`rating` integer,
	`expected_salary` integer DEFAULT 0 NOT NULL,
	`current_company` text,
	`notice_period_days` integer,
	`notes` text,
	`rejection_reason` text,
	`employee_id` integer,
	`sort_order` real DEFAULT 0 NOT NULL,
	`stage_changed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `job_openings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `candidates_job` ON `candidates` (`job_id`);--> statement-breakpoint
CREATE INDEX `candidates_org` ON `candidates` (`org_id`);--> statement-breakpoint
CREATE TABLE `canned_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comp_off_credits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`worked_date` text NOT NULL,
	`days` real DEFAULT 1 NOT NULL,
	`reason` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`expires_on` text,
	`decided_by` integer,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `compoff_emp` ON `comp_off_credits` (`employee_id`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`name` text NOT NULL,
	`industry` text,
	`website` text,
	`phone` text,
	`gstin` text,
	`billing_address` text,
	`city` text,
	`state` text,
	`country` text DEFAULT 'India',
	`owner_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `companies_org` ON `companies` (`org_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`company_id` integer,
	`name` text NOT NULL,
	`title` text,
	`email` text,
	`phone` text,
	`owner_id` integer,
	`lifecycle` text DEFAULT 'lead' NOT NULL,
	`source` text DEFAULT 'other' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contacts_org` ON `contacts` (`org_id`);--> statement-breakpoint
CREATE INDEX `contacts_email` ON `contacts` (`org_id`,`email`);--> statement-breakpoint
CREATE TABLE `credit_note_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`credit_note_id` integer NOT NULL,
	`invoice_line_id` integer,
	`product_id` integer,
	`description` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_code` text,
	`amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cn_lines_cn` ON `credit_note_lines` (`credit_note_id`);--> statement-breakpoint
CREATE TABLE `credit_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`number` text NOT NULL,
	`invoice_id` integer NOT NULL,
	`date` text NOT NULL,
	`reason` text NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`restock` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cn_org_number` ON `credit_notes` (`org_id`,`number`);--> statement-breakpoint
CREATE TABLE `crm_activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`deal_id` integer,
	`contact_id` integer,
	`company_id` integer,
	`type` text NOT NULL,
	`subject` text NOT NULL,
	`body` text,
	`due_date` text,
	`done` integer DEFAULT false NOT NULL,
	`owner_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crm_act_org` ON `crm_activities` (`org_id`);--> statement-breakpoint
CREATE INDEX `crm_act_deal` ON `crm_activities` (`deal_id`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`title` text NOT NULL,
	`company_id` integer,
	`contact_id` integer,
	`owner_id` integer,
	`value` integer DEFAULT 0 NOT NULL,
	`stage` text DEFAULT 'lead' NOT NULL,
	`probability` integer DEFAULT 10 NOT NULL,
	`source` text DEFAULT 'other' NOT NULL,
	`expected_close` text,
	`closed_at` integer,
	`lost_reason` text,
	`stage_changed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`invoice_id` integer,
	`project_id` integer,
	`sort_order` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deals_org` ON `deals` (`org_id`);--> statement-breakpoint
CREATE INDEX `deals_stage` ON `deals` (`org_id`,`stage`);--> statement-breakpoint
CREATE TABLE `departments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`name` text NOT NULL,
	`head_employee_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_org_name` ON `departments` (`org_id`,`name`);--> statement-breakpoint
CREATE TABLE `employee_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`type` text NOT NULL,
	`number` text,
	`issue_date` text,
	`expiry_date` text,
	`note` text,
	`file_id` integer,
	`shared` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `emp_docs_emp` ON `employee_documents` (`employee_id`);--> statement-breakpoint
CREATE INDEX `emp_docs_expiry` ON `employee_documents` (`org_id`,`expiry_date`);--> statement-breakpoint
CREATE TABLE `employee_letters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`template_id` integer,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`issued_by` integer,
	`issued_on` text NOT NULL,
	`shared` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `letters_emp` ON `employee_letters` (`employee_id`);--> statement-breakpoint
CREATE TABLE `employee_loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`type` text DEFAULT 'advance' NOT NULL,
	`principal` integer DEFAULT 0 NOT NULL,
	`monthly_installment` integer DEFAULT 0 NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`disbursed_on` text NOT NULL,
	`start_period` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `loans_emp` ON `employee_loans` (`employee_id`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`code` text NOT NULL,
	`user_id` integer,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`gender` text DEFAULT 'undisclosed' NOT NULL,
	`dob` text,
	`address` text,
	`department_id` integer,
	`designation` text NOT NULL,
	`manager_id` integer,
	`employment_type` text DEFAULT 'full_time' NOT NULL,
	`work_location` text,
	`join_date` text NOT NULL,
	`probation_end_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`exit_date` text,
	`exit_reason` text,
	`annual_ctc` integer DEFAULT 0 NOT NULL,
	`salary_components` text,
	`pf_enrolled` integer DEFAULT true NOT NULL,
	`metro` integer DEFAULT true NOT NULL,
	`pan` text,
	`uan` text,
	`bank_account` text,
	`ifsc` text,
	`nationality` text,
	`passport_number` text,
	`passport_expiry` text,
	`visa_number` text,
	`visa_expiry` text,
	`emirates_id` text,
	`emirates_id_expiry` text,
	`labour_card_number` text,
	`wps_person_id` text,
	`iban` text,
	`bank_name` text,
	`bank_routing_code` text,
	`shift_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `employees_org` ON `employees` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `employee_org_code` ON `employees` (`org_id`,`code`);--> statement-breakpoint
CREATE TABLE `enquiries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`company` text,
	`team_size` text,
	`interest` text,
	`message` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expense_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`reimburse_via` text DEFAULT 'payroll' NOT NULL,
	`decided_by` integer,
	`decided_at` integer,
	`rejection_reason` text,
	`payslip_id` integer,
	`reimbursed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claims_org_status` ON `expense_claims` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `claims_emp` ON `expense_claims` (`employee_id`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`date` text NOT NULL,
	`vendor_id` integer,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'paid' NOT NULL,
	`due_date` text,
	`paid_date` text,
	`payment_method` text,
	`reference` text,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `expenses_org_date` ON `expenses` (`org_id`,`date`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`uploaded_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `files_org` ON `files` (`org_id`);--> statement-breakpoint
CREATE TABLE `final_settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`exit_date` text NOT NULL,
	`service_days` integer NOT NULL,
	`pending_salary` integer DEFAULT 0 NOT NULL,
	`leave_encashment_days` real DEFAULT 0 NOT NULL,
	`leave_encashment` integer DEFAULT 0 NOT NULL,
	`gratuity` integer DEFAULT 0 NOT NULL,
	`other_earnings` integer DEFAULT 0 NOT NULL,
	`loan_recovery` integer DEFAULT 0 NOT NULL,
	`other_deductions` integer DEFAULT 0 NOT NULL,
	`net_payable` integer DEFAULT 0 NOT NULL,
	`breakdown` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`paid_on` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlement_emp` ON `final_settlements` (`employee_id`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cycle` text NOT NULL,
	`due_date` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'on_track' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goals_emp` ON `goals` (`employee_id`);--> statement-breakpoint
CREATE TABLE `holidays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`optional` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holiday_org_date` ON `holidays` (`org_id`,`date`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token` text NOT NULL,
	`invited_by` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`invoice_id` integer NOT NULL,
	`product_id` integer,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_code` text,
	`amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_lines_inv` ON `invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`number` text NOT NULL,
	`company_id` integer,
	`customer_name` text NOT NULL,
	`customer_email` text,
	`billing_address` text,
	`customer_gstin` text,
	`place_of_supply` text,
	`issue_date` text NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`amount_paid` integer DEFAULT 0 NOT NULL,
	`amount_credited` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`deal_id` integer,
	`project_id` integer,
	`sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_org_number` ON `invoices` (`org_id`,`number`);--> statement-breakpoint
CREATE INDEX `invoices_org_status` ON `invoices` (`org_id`,`status`);--> statement-breakpoint
CREATE TABLE `job_openings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`title` text NOT NULL,
	`department_id` integer,
	`location` text,
	`employment_type` text DEFAULT 'full_time' NOT NULL,
	`openings` integer DEFAULT 1 NOT NULL,
	`salary_min` integer DEFAULT 0 NOT NULL,
	`salary_max` integer DEFAULT 0 NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`hiring_manager_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `jobs_org` ON `job_openings` (`org_id`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`date` text NOT NULL,
	`memo` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` integer,
	`reversed` integer DEFAULT false NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `je_org_date` ON `journal_entries` (`org_id`,`date`);--> statement-breakpoint
CREATE INDEX `je_source` ON `journal_entries` (`org_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`entry_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`debit` integer DEFAULT 0 NOT NULL,
	`credit` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jl_entry` ON `journal_lines` (`entry_id`);--> statement-breakpoint
CREATE INDEX `jl_account` ON `journal_lines` (`org_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `kb_articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`category` text DEFAULT 'General' NOT NULL,
	`body` text NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kb_org_slug` ON `kb_articles` (`org_id`,`slug`);--> statement-breakpoint
CREATE TABLE `leave_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`leave_type_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`half_day` integer DEFAULT false NOT NULL,
	`days` real NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` integer,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `leave_org` ON `leave_requests` (`org_id`);--> statement-breakpoint
CREATE INDEX `leave_emp` ON `leave_requests` (`employee_id`);--> statement-breakpoint
CREATE TABLE `leave_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`annual_quota` real DEFAULT 0 NOT NULL,
	`paid` integer DEFAULT true NOT NULL,
	`pay_percent` integer DEFAULT 100 NOT NULL,
	`applies_to` text DEFAULT 'all' NOT NULL,
	`accrual` text DEFAULT 'annual' NOT NULL,
	`carry_forward_max` real DEFAULT 0 NOT NULL,
	`encashable` integer DEFAULT false NOT NULL,
	`color` text DEFAULT 'mint' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `letter_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_org_user` ON `memberships` (`org_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`due_date` text,
	`done` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `milestones_project` ON `milestones` (`project_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`href` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `onboarding_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`due_date` text,
	`done` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `onboarding_emp` ON `onboarding_tasks` (`employee_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`country` text DEFAULT 'IN' NOT NULL,
	`phone` text,
	`timezone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`state` text,
	`gstin` text,
	`address` text,
	`automations` text DEFAULT '{}' NOT NULL,
	`enabled_modules` text,
	`weekend_days` text DEFAULT '[0,6]' NOT NULL,
	`fiscal_year_start` integer DEFAULT 4 NOT NULL,
	`statutory` text DEFAULT '{}' NOT NULL,
	`attendance_token_hash` text,
	`helpdesk_auto_assign` integer DEFAULT false NOT NULL,
	`helpdesk_last_assignee` integer,
	`owner_id` integer NOT NULL,
	`plan` text DEFAULT 'growth' NOT NULL,
	`trial_started_at` integer NOT NULL,
	`trial_ends_at` integer NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`subscription_status` text,
	`billing_interval` text,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`card_brand` text,
	`card_last4` text,
	`card_exp_month` integer,
	`card_exp_year` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_hash_unique` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`invoice_id` integer NOT NULL,
	`date` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`method` text DEFAULT 'bank_transfer' NOT NULL,
	`reference` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payments_inv` ON `payments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `payroll_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`period` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`days_in_month` integer NOT NULL,
	`employee_count` integer DEFAULT 0 NOT NULL,
	`total_gross` integer DEFAULT 0 NOT NULL,
	`total_deductions` integer DEFAULT 0 NOT NULL,
	`total_net` integer DEFAULT 0 NOT NULL,
	`total_employer_cost` integer DEFAULT 0 NOT NULL,
	`approved_by` integer,
	`approved_at` integer,
	`paid_at` integer,
	`payment_date` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payroll_org_period` ON `payroll_runs` (`org_id`,`period`);--> statement-breakpoint
CREATE TABLE `payslips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`employee_name` text NOT NULL,
	`employee_code` text NOT NULL,
	`designation` text,
	`department` text,
	`paid_days` real NOT NULL,
	`lop_days` real DEFAULT 0 NOT NULL,
	`basic` integer DEFAULT 0 NOT NULL,
	`hra` integer DEFAULT 0 NOT NULL,
	`special` integer DEFAULT 0 NOT NULL,
	`bonus` integer DEFAULT 0 NOT NULL,
	`other_earnings` integer DEFAULT 0 NOT NULL,
	`gross` integer DEFAULT 0 NOT NULL,
	`pf_employee` integer DEFAULT 0 NOT NULL,
	`esi_employee` integer DEFAULT 0 NOT NULL,
	`professional_tax` integer DEFAULT 0 NOT NULL,
	`tds` integer DEFAULT 0 NOT NULL,
	`other_deductions` integer DEFAULT 0 NOT NULL,
	`total_deductions` integer DEFAULT 0 NOT NULL,
	`net` integer DEFAULT 0 NOT NULL,
	`pf_employer` integer DEFAULT 0 NOT NULL,
	`esi_employer` integer DEFAULT 0 NOT NULL,
	`transport` integer DEFAULT 0 NOT NULL,
	`reimbursements` integer DEFAULT 0 NOT NULL,
	`loan_deduction` integer DEFAULT 0 NOT NULL,
	`pension_employee` integer DEFAULT 0 NOT NULL,
	`pension_employer` integer DEFAULT 0 NOT NULL,
	`gratuity_accrual` integer DEFAULT 0 NOT NULL,
	`employer_cost` integer DEFAULT 0 NOT NULL,
	`breakdown` text,
	`note` text,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payslips_run` ON `payslips` (`run_id`);--> statement-breakpoint
CREATE INDEX `payslips_emp` ON `payslips` (`employee_id`);--> statement-breakpoint
CREATE TABLE `performance_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`reviewer_id` integer,
	`cycle` text NOT NULL,
	`self_rating` integer,
	`self_comments` text,
	`manager_rating` integer,
	`strengths` text,
	`improvements` text,
	`status` text DEFAULT 'self_review' NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_emp_cycle` ON `performance_reviews` (`employee_id`,`cycle`);--> statement-breakpoint
CREATE TABLE `poll_votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`poll_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`option` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `poll_vote_user` ON `poll_votes` (`poll_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `polls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`anonymous` integer DEFAULT true NOT NULL,
	`closes_on` text,
	`created_by` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`name` text NOT NULL,
	`sku` text NOT NULL,
	`barcode` text,
	`category` text,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`cost_price` integer DEFAULT 0 NOT NULL,
	`selling_price` integer DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 18 NOT NULL,
	`reorder_level` real DEFAULT 0 NOT NULL,
	`reorder_qty` real DEFAULT 0 NOT NULL,
	`preferred_vendor_id` integer,
	`track_stock` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`preferred_vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_org_sku` ON `products` (`org_id`,`sku`);--> statement-breakpoint
CREATE INDEX `products_org` ON `products` (`org_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`company_id` integer,
	`description` text,
	`owner_id` integer,
	`color` text DEFAULT 'lilac' NOT NULL,
	`billing_type` text DEFAULT 'fixed' NOT NULL,
	`budget` integer DEFAULT 0 NOT NULL,
	`hourly_rate` integer DEFAULT 0 NOT NULL,
	`start_date` text,
	`due_date` text,
	`status` text DEFAULT 'planning' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `projects_org` ON `projects` (`org_id`);--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`po_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `po_lines_po` ON `purchase_order_lines` (`po_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`number` text NOT NULL,
	`vendor_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`order_date` text NOT NULL,
	`expected_date` text,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`received_at` integer,
	`expense_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_org_number` ON `purchase_orders` (`org_id`,`number`);--> statement-breakpoint
CREATE TABLE `quote_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`quote_id` integer NOT NULL,
	`product_id` integer,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`discount_percent` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_code` text,
	`amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quote_lines_q` ON `quote_lines` (`quote_id`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`number` text NOT NULL,
	`deal_id` integer,
	`company_id` integer,
	`contact_id` integer,
	`customer_name` text NOT NULL,
	`customer_email` text,
	`place_of_supply` text,
	`issue_date` text NOT NULL,
	`valid_until` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`terms` text,
	`invoice_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_org_number` ON `quotes` (`org_id`,`number`);--> statement-breakpoint
CREATE TABLE `recurring_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`template_invoice_id` integer NOT NULL,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`next_date` text NOT NULL,
	`end_date` text,
	`auto_send` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_generated_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recurring_org` ON `recurring_invoices` (`org_id`);--> statement-breakpoint
CREATE TABLE `sequences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`key` text NOT NULL,
	`next` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sequence_org_key` ON `sequences` (`org_id`,`key`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`name` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`grace_minutes` integer DEFAULT 15 NOT NULL,
	`half_day_minutes` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sla_policies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`priority` text NOT NULL,
	`first_response_mins` integer NOT NULL,
	`resolution_mins` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sla_org_priority` ON `sla_policies` (`org_id`,`priority`);--> statement-breakpoint
CREATE TABLE `stock_count_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`count_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`expected_qty` real NOT NULL,
	`counted_qty` real,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`count_id`) REFERENCES `stock_counts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sc_line_product` ON `stock_count_lines` (`count_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `stock_counts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`number` text NOT NULL,
	`warehouse_id` integer NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`note` text,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sc_org_number` ON `stock_counts` (`org_id`,`number`);--> statement-breakpoint
CREATE TABLE `stock_levels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_product_wh` ON `stock_levels` (`product_id`,`warehouse_id`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`type` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`reference` text,
	`source_type` text,
	`source_id` integer,
	`note` text,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stock_mv_org` ON `stock_movements` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_mv_product` ON `stock_movements` (`product_id`);--> statement-breakpoint
CREATE TABLE `task_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`task_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_comments_task` ON `task_comments` (`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`milestone_id` integer,
	`title` text NOT NULL,
	`description` text,
	`assignee_id` integer,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`start_date` text,
	`due_date` text,
	`estimate_hours` real,
	`sort_order` real DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_project` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_org` ON `tasks` (`org_id`);--> statement-breakpoint
CREATE TABLE `tax_declarations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`fiscal_year` text NOT NULL,
	`regime` text DEFAULT 'new' NOT NULL,
	`items` text DEFAULT '{}' NOT NULL,
	`proof_file_ids` text DEFAULT '[]' NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`reviewed_by` integer,
	`review_note` text,
	`updated_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_decl_emp_fy` ON `tax_declarations` (`employee_id`,`fiscal_year`);--> statement-breakpoint
CREATE TABLE `ticket_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`ticket_id` integer NOT NULL,
	`author_type` text NOT NULL,
	`author_id` integer,
	`body` text NOT NULL,
	`internal` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_msgs` ON `ticket_messages` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`number` text NOT NULL,
	`subject` text NOT NULL,
	`description` text,
	`requester_name` text NOT NULL,
	`requester_email` text NOT NULL,
	`contact_id` integer,
	`company_id` integer,
	`channel` text DEFAULT 'email' NOT NULL,
	`category` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_id` integer,
	`first_response_due_at` integer,
	`resolution_due_at` integer,
	`first_responded_at` integer,
	`resolved_at` integer,
	`closed_at` integer,
	`csat_rating` integer,
	`csat_comment` text,
	`public_token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_org_number` ON `tickets` (`org_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_token` ON `tickets` (`public_token`);--> statement-breakpoint
CREATE INDEX `tickets_org_status` ON `tickets` (`org_id`,`status`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`task_id` integer,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`hours` real NOT NULL,
	`description` text,
	`billable` integer DEFAULT true NOT NULL,
	`invoice_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `time_project` ON `time_entries` (`project_id`);--> statement-breakpoint
CREATE INDEX `time_emp_date` ON `time_entries` (`employee_id`,`date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`company` text,
	`phone` text,
	`password_hash` text NOT NULL,
	`google_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_id_unique` ON `users` (`google_id`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`gstin` text,
	`address` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vendors_org` ON `vendors` (`org_id`);--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`address` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warehouse_org_code` ON `warehouses` (`org_id`,`code`);