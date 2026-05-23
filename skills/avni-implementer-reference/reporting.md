# Reporting + business analytics

> 6 sections vendored from `avniproject/avni-ai/dify/merged.md` (branch `app-configurator-dev`).
> Regenerate via `node scripts/build-implementer-reference.mjs` when upstream changes.

---

## `readme/General/architecture/reporting-in-avni/getting-started-with-avni-reports.md`

title: Getting Started with Avni Self-Service Reports 📊
excerpt: ''
## What This Guide Will Help You Do

This guide will help you learn how to create reports and visualize your Avni data in Metabase, even if you've never worked with data tools before! We'll walk through real examples with step-by-step instructions.

<Callout icon="💡" theme="default">
  ### **Quick Tip:** This guide focuses on practical everyday tasks. If you need information about setup or administration, please refer to the [Self-Service Reports Guide for Avni](self-service-reports-guide-for-avni). If needed, contact Avni support team for further guidance.
</Callout>

## The Basics: Understanding Metabase

### What is Metabase and why should I care?

Metabase is a simple tool that helps you look at your organisation's data in Avni, without needing technical skills. Think of it like a smart photo editor for your data - it helps you:

* See overall Avni organisation data at a glance
* Create charts and graphs easily
* Share insights with your team
* Make better decisions based on actual numbers
* Identify trends and patterns in your data

### How to Log In 🔑

1. Open your web browser and go to [https://reporting.avniproject.org/](https://reporting.avniproject.org/)
2. Enter your email address
3. Enter your password
4. Click the "Log in" button

<Image align="center" src="https://files.readme.io/95b3cfa20f75003a170accb2312b13b1ff51752a37ffbeb1130366d044e37d8f-Screenshot_2025-05-26_at_12.07.51_PM.png" />

### Help! I Can't Log In 🆘

Don't worry! Try these steps:

1. Click the "Forgot Password" link on the login page
2. Enter your email address to receive reset instructions
3. If that doesn't work, contact your Avni support team for help

### Who Can See My Reports? 👁️

Only people from your organization can see your data and reports:

* Team members in your organization
* System administrators who help manage the platform

### Where Does This Data Come From? 📱→💾

All the data you see in reports comes from information collected by field workers using:

* The Avni mobile app on phones and tablets
* The Avni web application on computers

This information is automatically organized into easy-to-use tables via the ETL service, that you can explore in Metabase.

## Understanding Your Data

### What Are Data Tables?

In Avni, your information is organized in **tables** - think of them like Excel spreadsheets or organized lists. Each table contains specific information about your program. The Avni ETL service creates special reporting-friendly tables that make it easy to build reports and visualizations.

<Image alt="Example of a data table" align="center" src="https://files.readme.io/668dae0c3299f96b27bc34928466b31a2baff73ca24c4c9c38b98c7d9c3ad01e-metabase_database_tables.png">
  Example of organisation specific tables
</Image>

### Your Main Tables Explained

Here are all the important tables you'll work with in Metabase:

#### 1. Subject Tables

These tables contain information about the main people or things you track:

* **Example:** `Individual`, `Household`, `Facility`
* Each row represents one person or entity in your program
* Contains basic information like name, ID, registration date, address details
* Table names follow the pattern: `<subjectType>`

#### 2. Encounter Tables

These tables show visits or interactions that happened outside any program:

* **Example:** `Individual_Baseline`, `Household_Annual_Visit`
* Each row represents one visit or interaction
* Contains all the information collected during that encounter
* Table names follow the pattern: `<subjectType>_<encounterType>`
* Cancelled encounters are in separate tables named: `<subjectType>_<encounterType>_cancel`

#### 3. Program Tables

These tables show which people are enrolled in which programs:

* **Example:** `Individual_Nutrition_Program`, `Individual_Pregnancy`
* Each row represents one person's enrollment in a program
* Contains enrollment details like date joined, date exited
* Table names follow the pattern: `<subjectType>_<programName>`
* Program exits are in separate tables named: `<subjectType>_<programName>_exit`

#### 4. Program Encounter Tables

These tables show visits that happened within specific programs:

* **Example:** `Individual_Nutrition_Program_Monthly_Visit`
* Each row represents one program visit
* Contains all information collected during that program visit
* Table names follow the pattern: `<subjectType>_<programName>_<encounterType>`
* Cancelled program encounters are in separate tables named: `<subjectType>_<programName>_<encounterType>_cancel`

#### 5. Supporting Tables

Additional tables that help with specific data types:

* **Address Table:** Contains detailed address information for all subjects
* **Media Table:** Stores all media files (images, documents) in your system
* **Repeatable Group Tables:** For information that can appear multiple times
  * Table names follow the pattern: `<parentTable>_<question_group_concept_name>`

### Try It Yourself: Exploring Tables

Let's explore these tables together:

1. **Open the Data Browser:**
   * Click on "Browse Data" at the top of the screen
   * Find and click on the folder labeled with your Organisation Name, Ex: "BI DEMO"

2. **Look at any of the Subject Type Table:**
   * Click on any of the Subject Type Table, Ex: "beneficiary" table
   * Notice each person has a unique ID number
   * Browse through the information like names and addresses

3. **Understand How Tables Connect:**
   * Open any ProgramEnrolment / ProgramEncounter Table,"participation" table
   * Find the "Individual ID" column
   * This ID connects to the ID numbers in the "beneficiary" table
   * Similarly, the "Program ID" connects to IDs in the program table

> **Understanding Connections:** Tables connect through ID numbers. Think of it like this: if beneficiary #123 appears in the participation table with program #456, it means that person is enrolled in that specific program.

## Finding Exactly What You Need

### Filtering: Zooming In On Specific Information

Filtering lets you focus on exactly the information you care about - like looking at beneficiaries from only certain states or programs started after a specific date.

<Image alt="Example of filtering" align="center" src="https://files.readme.io/3d93f33b5a5a65a883c866755c4e25bf7928d30d28fa70ced336140c87aa5460-Screenshot_2025-05-26_at_12.20.49_PM.png">
  Example of Filters configuration screen for a table
</Image>

### Try It Yourself: Simple Filtering

**Exercise 1: Filter by State**

1. Open any of the Subject Type Table, Ex: "beneficiary" table
2. Find any address related column, Ex: "state" column and click on it
3. Choose "Filter by this column" from the menu
4. Select a few addresses (states) you're interested in
5. Click "Add Filter" to see only people from those states

**Exercise 2: Create Custom Filters**

1. Open any of the ProgramEnrolment / ProgramEncounter Table, Ex: "participation" table
2. Look for the "Filter" button at the top right of the screen
3. Add criteria Ex: "Role equals Caregiver"
4. Click "Apply Filter" to see the results

### Saving Your Work For Later

When you create a useful report:

1. Click the "Save" button
2. Give your report a clear name (add your name to avoid confusion)
3. Choose where to save it (your personal collection or a shared folder)

> **Why Save?** Save your reports so you don't have to recreate them every time. It's like bookmarking a webpage you want to visit again!

### Creating Summaries: The Big Picture

### Creating Summary Reports: Counting and Grouping

Summarizing helps you count things by categories - like how many beneficiaries are in each state or how many people are in each program.

<Image alt="Example of a summary" align="center" src="https://files.readme.io/a2de7339d09d2e80d4e7bd3167c95b171df2c27033acc8848889fc995daa2e30-Screenshot_2025-05-26_at_12.22.33_PM.png">
  Example of Summarization of a table
</Image>

**Try It: Create Your First Summary**

1. **Start with filtering:**
   * Open any of the ProgramEnrolment / ProgramEncounter Table, Ex: "participation" table
   * Click "Filter" at the top
   * Choose "Last Visit Date" and select "Last month"
   * Click "Apply" to see only recent visits

2. **Then create a summary:**
   * Click the "Summarize" button
   * Under "Group by" select "State"
   * Watch how your data transforms into a count by state!

3. **Create a visualization:**
   * Look at the bottom left for "Visualization"
   * Click and choose "Pie Chart"
   * Click "Done" to see your beautiful chart

> **What Did We Just Do?** We created a report showing how many beneficiaries from each state had visits in the last month. This helps you see which states are most active!

### Bringing Different Information Together: Using Joins

**What is a Join?** 

A join lets you combine information from different tables. Think of it like putting two spreadsheets side by side and connecting matching rows.

For example, you might want to see beneficiary names alongside their program enrolments, even though this information is stored in separate tables.

<Image alt="Illustration of a join concept" align="center" src="https://files.readme.io/761b483d4b5dffb3867f47eed8e460645879b9819abf4572feb7032248cc4436-Screenshot_2025-05-26_at_12.24.02_PM.png">
  Illustration of a join in Metabase
</Image>

**Try It: Joining Tables Step by Step**

1. **Start with the basic table:**
   * Open any of the ProgramEnrolment / ProgramEncounter Table, Ex: "participation" table
   * Look for the button next to "Summarize" (it's labeled "View")
   * Click it to enter editing mode

2. **Select which columns you want:**
   * Keep only the columns you're interested in
   * For example: keep "Role" and "Beneficiary ID"

3. **Connect to another table:**
   * Find and click "Join Data"
   * Select the related Subject Type table, Ex: "beneficiary" table
   * Click the join button

4. **Tell Metabase how to connect the tables:**
   * Choose ProgramEnrolment / ProgramEncounter Table -> Subject Type Table, Ex: "participation" -> "beneficiary"
   * Match ProgramEnrolment / ProgramEncounter Table Reference ID column with Subject Type Table ID column, Ex: "beneficiary\_id" with "ID"
   * Click "Join these columns"

5. **Clean up your view:**
   * Remove any extra columns you don't need
   * Click "Visualize" to see your combined data

**Make It Look Nice:**

* Go to the "Visualization" section
* Click the gear icon above the table
* Rename columns to make them easier to understand
* For example, change "beneficiary\_id" to "Person ID"

> **Why This Matters:** By joining tables, you can see complete information in one view. For instance, you can see a person's name and address along with which programs they're enrolled in, even though that information comes from different tables.

### Practice Activities: Try It Yourself

Now that you've learned how to join tables, try these exercises to build your skills:

1. **Create a Summary Chart by Category:**
   * Use any joined data you've created
   * Click "Summarize"
   * Group by any category field of your choice (like Role, Gender, Age Group, etc.)
   * Switch to a bar graph visualization
   * See the distribution across your chosen category!

2. **Create a Program Enrolment Chart:**
   * Join any Program Enrolment table with its related Program table
   * Group by "Program Name" or another program attribute
   * Create a bar graph showing counts by program

3. **Build a Complete Profile View:**
   * Create a table with address fields (like "State", "District"), person details, program information, and other relevant attributes
   * Use the Sort feature to organize your data logically (e.g., by location)
   * This gives you a complete view of who is enrolled where!

## Creating Your Own Calculations

### Adding Custom Columns

Sometimes you need information that isn't directly in your data. Metabase lets you create your own calculations!

<Image alt="Example of a custom column" align="center" width="250px" src="https://files.readme.io/f51d52859d073fc002b91aa87b3a99332b880592c05e99963ebe302fc4b30c1e-Screenshot_2025-05-26_at_12.30.07_PM.png">
  Example of a custom column
</Image>

**Try It: Calculate Address Length**

Let's say you want to see how long each person's address is:

1. Open any of the Subject Type Table, Ex: "beneficiary" table
2. Click "Edit Query" (near the top of the screen)
3. Find and click the "+ Add custom column" button
4. For the formula, type: `length([Address])`
5. Name your column: "Address length"
6. Click "Done" then "Visualize" to see your new column!

### Advanced Analysis: Grouping and Averaging

**What if you want to see the average address length for each district?**

This is where grouping comes in - it's like organizing your data into buckets and then calculating something about each bucket.

**Try It: Calculate Averages by Group**

1. Start with your table that has the Address length column

2. Click "Summarize"

3. Set up your grouping:
   * Group by "State" and "District"
   * For the calculation, choose "Average of" → "Address length"

4. Add filters if needed:
   * Maybe filter where "Address is not empty"

5. Use "Sort" to organize by state and district

6. Click "Visualize" to see your results

### Visualize Your Results

**Try creating different visualizations:**

<Image align="center" src="https://files.readme.io/1e7745387046fb5bbf15f45ad3d7524914fd92b6597c7e2725f9bd85ab7681e1-Screenshot_2025-05-26_at_12.32.38_PM.png" />

1. Try a line graph for the address length data
2. Try a bar chart comparing districts
3. Try a map visualization if geographical data is available

> **Final Tip:** The best reports answer specific questions. Before creating a report, ask yourself: "What exactly do I want to know?" Then build your report to answer that question!

## Additional Information regarding behind the Scenes: How Your Data Gets generated for use in Reporting 🔧

### Why We Need Special Reports Tables

You might wonder why you're using special tables for reporting instead of the regular Avni database. Here's a simple explanation:

**The Challenge:**\
The main Avni database is designed for collecting and storing data efficiently across organizations, not for creating reports. This creates several challenges:

1. **Complex Data Structures:** Some information is stored in specialized formats that are hard to query
2. **Performance Issues:** Running reports directly on the main database would be very slow
3. **Address Complexity:** Address information has many levels (state, district, etc.) that are difficult to work with
4. **Data Volume:** Analyzing all the data at once would be overwhelming

### How Avni Solves This: The ETL Service 🔄

Avni uses a standard process (called ETL - Extract, Transform, Load) that:

1. Copies data from the main database into a separate organization-specific database
2. Reorganizes it into formats better suited for reporting
3. Updates this reporting-friendly data periodically every hour or so)

### The Special Tables Created For You

The ETL service creates several easy-to-use tables:

* **Subject Tables:** One table for each type of person or thing you track (Ex: `Individual` or `Household`)
* **Encounter Tables:** Tables that show visits or interactions (Ex: `Individual_Baseline` or `Individual_Annual_Visit`)
* **Program Tables:** Information about program enrollment (Ex: `Individual_Nutrition_Program`)
* **Program Encounter Tables:** Records of visits within programs (Ex: `Individual_Nutrition_Program_Monthly_Visit`)
* **Supporting Tables:** Special tables for addresses, images, and repeated information

<Callout icon="💡" theme="default">
  ### **Technical Note:** Table names follow patterns like `<subjectType>_<encounterType>` or `<subjectType>_<programName>_<encounterType>` to make them easy to identify.
</Callout>

### What This Means For You

* You get faster reports
* You can easily create visualizations
* Your data is organized in a way that makes sense for analysis
* Everything updates automatically every hour or so

All of this happens behind the scenes so you can focus on getting insights from your data rather than worrying about database structures!

---

## `readme/General/architecture/reporting-in-avni/self-service-reports-guide-for-avni.md`

title: Self-Service Reports Guide for Avni
excerpt: ''
## Table of Contents

* [Introduction](#introduction)
* [Prerequisites](#prerequisites)
* [Setup Process](#setup-process)
* [User Management](#user-management)
* [Navigation](#navigation)
* [Reporting Features](#reporting-features)
* [Troubleshooting](#troubleshooting)
* [Refresh Process](#refresh-process)
* [Teardown Process](#teardown-process)
* [Appendix](#appendix)

## Introduction

### What is Metabase?

Metabase is a powerful open-source analytics and visualization tool that Avni integrates to provide comprehensive reporting capabilities. It allows you to create custom dashboards, run ad-hoc queries, and share insights across your organization with simple drag-and-drop operations.

### Self-Service Reports in Avni

Self-service Reports is a feature in Avni that allows users to create and manage reports without requiring technical expertise. It provides a user-friendly interface for creating and managing reports, and allows users to schedule and distribute reports via email.\
In Avni, we make use of Metabase to power Self-Service Reports.

> **Note:** This guide provides comprehensive documentation for setup, user management, and administration of Self-Service Reports. For hands-on training with practical exercises for using Metabase on your Avni Data, please refer to the [Getting started with Avni Metabase reports](getting-started-with-avni-reports) guide.

### Benefits of Metabase

* **User-friendly interface**: Create visualizations with simple drag-and-drop operations
* **Customizable dashboards**: Build tailored views for different stakeholders
* **Automated reporting**: Schedule and distribute reports via email
* **Data exploration**: Empower users to find insights without technical expertise
* **Secure access control**: Manage permissions at granular levels

### Inbuilt Capabilities of Self-Service Reports

Self-service Reports in Avni provides the following capabilities:

1. Creates a dedicated database user with appropriate permissions
2. Establishes a connection between Metabase and your Avni database
3. Sets up user groups and permission structures
4. Create standard Questions
5. Create collection with default dashboard

## Prerequisites

* ETL has to be enabled for your organisation, contact Avni-support team for any help regarding this.
* You need to be logged-in as a user, who belongs to a UserGroup with Analytics Privilege for your organization in Avni

<Image align="center" className="border" width="420px" border={true} src="https://files.readme.io/08e4962e2a1df9c5d3b5967ca92e0c5ac18acf0ee573971b547a4562f78e1c51-Screenshot_2025-05-20_at_7.25.43_PM.png" />

## Setup Process

### 1. Enabling Self-Service Reports

Self-Service Reports is managed at the organization level in Avni:

1. Log in to your Avni webapp
2. Navigate to Reports section
3. Click on "Self-service Reports" tab
4. Click on "Setup Reports" button

![Initial Setup State](https://files.readme.io/cdaa0376b8d1b7fbe8a1d776681b23a8f4643cbbc44c290888e5fcf356b23dd4-metabase_initial_state.png)\
*Figure 2: Initial state before Self-Service Reports setup with "Setup Reports" button*

### 2. Setup Process Stages

The setup process goes through several stages:

#### Initial Setup

When you first enable Self-Service Reports, you'll see the "Setup Reports" button. Clicking this button initiates the setup process.

#### Setup in Progress

During the setup process, you'll see a loading indicator:

![Setup in Progress](https://files.readme.io/34792bee15afc7e3ddf4a88a31e62ba4c23a8131971377c52df7a81c624c599d-metabase_loading_state.png)\
*Figure 3: Setup in progress with loading spinner*

The setup process typically takes 15-30 minutes to complete and involves:

* Database connection setup
* Initial schema synchronization
* Permission configuration
* Default Collection and Dashboard creation
* Default questions creation

#### Partial Setup

Sometimes, the setup may complete partially with only some resources available:

![Partial Setup](https://files.readme.io/61242bf6bcce5582259ac4ba46363b9cd90a102be6511728d18b6623e4417ada-metabase_partial_setup.png)\
*Figure 4.a: Partial setup with only Database resource available*

In this state, you can either:

* Wait for the remaining resources to be created automatically
* Click "Setup Reports" again to retry the setup process

### 3. Verifying Setup Completion

You can verify the setup was successful by:

1. Confirming the "Explore Your Data" button is available
2. Testing access with a user that has been added to the "Metabase Users" group in Avni

<Image align="center" src="https://files.readme.io/f0c5a313f302629bfa838cfcbbc368aac06d42a079c016331de3295e7df915a0-metabase_refresh_reports.png" />

*Figure 4.b : Successfully completed setup\
(Note: Delete button only available in development environments)*

## User Management

### User Group Synchronization

Avni automatically synchronizes users between the Avni platform and Metabase. This synchronization ensures that users added to the "Metabase Users" group in Avni can access analytics in Metabase.

#### Adding Users in Avni

To grant users access to Metabase analytics:

1. Navigate to User Groups Management in Avni Admin App
2. Select the "Metabase Users" group
3. Add the user(s) you want to grant access to the group
4. Save changes
5. User added to "Metabase Users" group, will receive an email with an account activation link

Note: Removing users from the "Metabase Users" group will remove their access to Metabase analytics.

![Avni User Groups](https://files.readme.io/5c483f0cd5480029f298a23961dfb5248f633d13195022546bc8af4248cddac7-metabase_user_groups.png)*Figure 5: Avni user groups management interface showing Metabase Users group*

#### Verification in Metabase

After adding users to the Metabase Users group in Avni, you can verify their synchronization in the Metabase admin interface:

![Metabase Admin People](https://files.readme.io/cf18e6606710fc311495adec917571095ba46e793afadd92e731a17f192fdaf1-metabase_admin_people.png)*Figure 6: Metabase Admin interface showing synchronized users*

The synchronization process:

1. Creates user accounts in Metabase with the same email addresses as in Avni
2. Includes the User in Metabase Group corresponding to their organization

## Navigation

You can navigate to Self-Service Reports from the Avni Sign-in screen, by clicking on the "METABASE REPORTS" button.

![Self-Service Reports Navigation](https://files.readme.io/5ca645c93da6b8a024963b55c58b245cb12f9c628d5a5e43eafbdf542a520699-metabase_navigate_from_avni.png)\
*Figure 7: Self-Service Reports Navigation via "Self-Service Reports" button available in Avni Sign-in screen*

## Reporting Features

### Canned Reports Dashboard

The Metabase integration includes a pre-configured "Canned Reports" dashboard that provides immediate value without requiring users to build reports from scratch.

![Canned Reports Dashboard](https://files.readme.io/7d99a2dae462bb202090ac6e4e6d73e21c47ce5a00c94c4eae4d2b09eb2ed74a-metabase_canned_reports.png)\
*Figure 8: Overview dashboard with multiple report visualizations*

Key features of the Canned Reports dashboard:

* Filter controls at the top (Date Range, Location filters, etc.)
* Multiple visualizations organized by subject area
* Interactive charts that respond to filter selections
* Donut charts showing distribution of key metrics
* Empty states for sections with no data ("No results!")
* Drill-down ability by clicking on section of Donut (or of any part of different type of vizualizations)

<Image align="center" src="https://files.readme.io/0ce0bacad8d607b479963694e94bcb13656b0f1068583aa0eaa2ed8cbe3b769b-Screenshot_2025-05-22_at_11.15.58_AM.png" />

*Figure 9: Drill-down ability, by clicking on Donut chart section or on other visualizations*

### Collection Structure

Metabase organizes reports and dashboards into collections. The default collection contains various pre-built reports:

![Collection Structure](https://files.readme.io/c62b3bd102960c9bbe38b26d36cd02980dd901cec84c54bba40c96dee98e4adf-metabase_collection.png)\
*Figure 10: Default collection structure showing dashboard and reports*

The collection includes:

* Canned Reports dashboard
* Individual report views (Completed Visits, Due Visits, etc.)
* Other Fundamental Database tables and views that power the reports

### Report Visualizations

Individual reports provide detailed visualizations of specific metrics:

![Completed / Due Visits Report](https://files.readme.io/9af7f3494e2d9173f4d6b4e74acfc9fadca9e606f95684af1f788575c5beaf2b-metabase_completed_visits.png)\
*Figure 11: Detailed visualization of Completed / Due Visits by type*

Visualization features include:

* Interactive donut charts with percentage breakdowns
* Clear labeling of data categories
* Total count displayed in the center
* Color-coded segments for easy differentiation

### Database Tables and Views

Metabase connects to your Avni database and creates optimized views for reporting:

![Database Tables and Views](https://files.readme.io/da4dc45abbb0f349603f03f05b2db26ed74f925793c729aa7199d464559ee17f-metabase_database_tables.png)\
*Figure 12: Database tables and views available in Self-Service Reports*

The database structure includes:

* Base tables (individual, household, address, etc.)
* Derived views (completed\_visits\_view, due\_visits\_view, etc.)
* Relationship tables (household\_individual, etc.)

These tables and views are automatically kept in sync with your Avni database.

### Data Exploration

Metabase allows users to explore raw data through table views:

![Individual Data Table](https://files.readme.io/cfbf4ea42ab9b037e39fc0fa1e23c7f4773c9c24bf0abd7ab598ac193815b637-metabase_individual_table.png)\
*Figure 13: Individual data table showing subject records*

![Child Data Table](https://files.readme.io/37921c0981d9e7914beaa68c5237b17baae544387131caef7ab1a4090476b09b-metabase_child_table.png)\
*Figure 14: Child data table showing specific program records*

Data exploration features include:

* Sortable columns
* Record counts and pagination
* Search functionality
* Filtering options
* Direct access to raw data

## Troubleshooting

### Error Reporting

When errors occur during the Self-Service Reports setup or synchronization process, they are displayed directly in the interface:

![Error Reporting Example](https://files.readme.io/e1e4f12702c93d949a5c05e685d120a159e2a42fee31ca6555dd4464312d883a-metabase_error_example.png)

*Figure 15: Example of an error message during Self-Service Reports setup\
(Note: Delete button only available in development environments)*

The error message includes:

* A clear indication that the attempt failed
* The specific Server error that occurred
* Details about what caused the error (in this example, a missing database table)
* A "Copy error to clipboard" button for easy sharing with support

Common errors include:

* Database connection issues
* Missing tables or schemas due to ETL failure
* ETL not enabled

### Common Issues and Solutions

| Issue                                   | Possible Cause                                                   | Solution                                             |
| --------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| Dashboard shows no data                 | Database sync incomplete, ETL process not completed successfully | Wait for sync / ETL process to complete successfully |
| User cannot access Self-Service Reports | Not in "Metabase Users" group                                    | Add user to the group in Avni                        |
| Missing tables or fields                | ETL not enabled or not completed successfully                    | Contact Support                                      |

## Refresh Process

### When to Use Refresh

The refresh process is to be used, whenever there are new Entity Types created for the organization.

### Performing a Refresh

To refresh Self-Service Reports integration:

1. In Avni admin panel, navigate to Reports section
2. Click "Self-Service Reports" tab
3. Click "Refresh Reports" button

<Image align="center" src="https://files.readme.io/5b4264a93cd8614a6e0eb42c41a84420cb99372c773554667e95ad48d1bcb214-metabase_refresh_reports.png" />

*Figure 16: Refresh Self-Service Reports setup by clicking on "REFRESH REPORTS"\
(Note: Delete button only available in development environments)*

Wait for the process to complete.

The refresh process will:

* Create missing dashboards, cards and questions

## Appendix

### Glossary of Terms

* **Collection**: A group of questions and dashboards in Metabase
* **Dashboard**: A customizable display of multiple visualizations
* **Question**: A saved query that produces a visualization or data table
* **Sync**: The process of updating Metabase's understanding of your organization's database structure
* **Card**: An individual visualization on a dashboard

---

## `readme/Implementers/reporting-and-business-analytics/ai-in-reporting.md`

title: Developing BI dashboards using AI services
excerpt: >-
  robots: index
next:
  description: ''
---
The tool used for this is Cursor which internally uses other AI services. You can download [Cursor](https://www.cursor.com/).

The source code used in this tool is available here [avni-ai-experiment](https://github.com/avniproject/avni-ai-experiment) (private repository as the CSV files used in the context may contain customer specific information). This repository will become a public repository soon. 

# Generate aggregate and line list query

### When to use

Excel or spreadsheet contain the requirements for the report all present in a single sheet. This is the input used for generating the SQL. If you do not have this file then the steps below are **not recommended** as it will not be productive approach.

### Setup

1. Open avni-ai-experiment in Cursor.
2. Download the requirement sheet as a CSV file. Copy its contents and put them in any file under `bi-reporting-spike/dataset/workspace` folder. Let's say - `requirement.csv`. An example is present in workspace folder by name `example.csv`.
3. Create one file which contains all the table definition in the `bi-reporting-spike/aggregate/workspace`  or `bi-reporting-spike/linelist/workspace` folder. Let's say - `table-def.sql`. An example is present in workspace folder by name `example-jnpct-def.sql`. This was generated from IntelliJ (select schema and generate).

### Chat

1. Open chat window in Cursor.
2. Prompt to forget everything (line 1 of `aggregate-query-prompt.md` or `linelist-query-prompt.md`)
3. Follow the steps in [https://github.com/avniproject/avni-ai-experiment/blob/main/bi-reporting-spike/aggregate/workspace/aggregate-query-prompt.md](https://github.com/avniproject/avni-ai-experiment/blob/main/bi-reporting-spike/aggregate/workspace/aggregate-query-prompt.md) or [https://github.com/avniproject/avni-ai-experiment/blob/master/bi-reporting-spike/linelist/workspace/line-list-prompt.md](https://github.com/avniproject/avni-ai-experiment/blob/master/bi-reporting-spike/linelist/workspace/line-list-prompt.md)

---

## `readme/Implementers/reporting-and-business-analytics/form-analytics-using-metabase-x-ray-feature.md`

title: Form analytics using Metabase X-Ray feature
excerpt: ''
Metabase xRay allows for generating basic analytics on click of a button from the database table. Please follow the steps below for setting up table analytics that can be used. The steps below having been provided at a logical level.

> 📘 Note: The dashboard created using this approach cannot be easily migrated to another database hence the development should be done in production database, else it will involve rework.

### Features relevant to us

* Auto generated breakup by coded fields
* Can see line list for each breakup
* Related tables can be mapped to logical names
* Internal columns can be removed
* Related table’s data can be seen from the line list (e.g. by clicking on Individual name)
* In pie-chart form also see the percentage
* Can be used with custom models feature

### Standard ETL table or Custom Model

It is possible that your requirement involves using joins with other table like location for using in filters. To achieve this use Custom Model feature and use the metabase designer to join. Using native query is not recommended - as that requires configuring the columns to make it understanding to metabase features.

In your custom model you may want to take filter out records like voided = true, or exited, cancelled etc.

### Table configuration changes

Available from Admin ->> Table Metadata tab.

Remove visibility of fields that do not concern the user. Some you can remove from **everywhere** and some only in **detail view** (line list view). Discuss with functional people in your team about the exact system fields to change.

### Generate xRay

1. Find a table from data source
2. Click xRay
3. Choose more details
4. Save the dashboard automatically created. You can also move this to the right place using move option. By default they do in the `Automatically Generated Dashboards`. Note - You cannot add filter before generating dashboards.

### Dashboard changes

* Remove any unnecessary generated filters and cards first. With fewer cards the performance of the dashboard during the design process will be better.
* Any field directly on the table/form can be added as filter.
* Only one address filter can be added per table/dashboard (note that table metadata should be changed to map too).

### Table configuration changes to make certain fields more useful

Metabase allows to map a foreign key field such that one can see a logical text instead of seeing a number. For example - individual\_id can be mapped to Individual.first\_name; address\_id can be mapped to Address.Title.

### Known Limitations

* Cannot do percentage only totals (why? - [https://avni.readme.io/docs/form-analytics-using-metabase-x-ray-feature](https://avni.readme.io/docs/form-analytics-using-metabase-x-ray-feature)) in non-pie chart form.
* Once xRay dashboard is generated subsequent addition of fields will have to be manual, otherwise the previous changes will be lost.

---

## `readme/Implementers/reporting-and-business-analytics/guide-to-export-and-import-reports-across-different-jasper-servers.md`

title: Guide To Export and Import Reports across different Jasper Servers
excerpt: ''
## Reference: [https://community.jaspersoft.com/documentation/jasperreports-server/tibco-jasperreports-server-security-guide/vv900/jasperreports-server-security-guide-\_-keymanagement-\_-import\_and\_export/#Key\_Command\_Line\_Export](https://community.jaspersoft.com/documentation/jasperreports-server/tibco-jasperreports-server-security-guide/vv900/jasperreports-server-security-guide-_-keymanagement-_-import_and_export/#Key_Command_Line_Export)

## Login into Source server

## Execute below commands to export the report

```
## Navigate to scripts dir
cd /home/ubuntu/jasperreports-server-cp-7.5.0-bin/buildomatic  
## Execute the report export script
./js-export.sh --uris /RWB_2023 --output-zip gramin_rwb_2023.zip --secret-key="\<specify_key_value>"  
## Copy the generated export file to home dir
cp gramin_rwb_2023.zip ~/  
## Exit
exit
```

## Transfer file to your system using scp

Ex: from your machine terminal

```shell Shell
scp jasper-reporting-openchs:gramin_rwb_2023.zip ./
```

## Login into Target Jasper server webapp

Import the zip file in target jasper using the "Key Value" option by specifying the key value "\<specify\_key\_value>" used during export.

<Image align="center" src="https://files.readme.io/6ca70fd-Screenshot_2024-03-15_at_4.32.26_PM.png" />

---

## `readme/Implementers/reporting-and-business-analytics/jasper-notes.md`

title: Jasper notes
excerpt: ''
### Self referential hierarchical reports

1. The contents of JRXML can be manipulated based on the url parameters. The url parameters can be coming from the same report at a higher level.
2. Each report can have filters specific to that level, which cannot be dynamically changed. So this is a blocker.

### Creating new version

This is to avoid changing the production version as it is already in use.

1. Copy can be created using export.
2. All the files are text files so these can be changed in editor and then imported after zipping.

---
