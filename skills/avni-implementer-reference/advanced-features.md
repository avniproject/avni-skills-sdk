# Advanced feature guide

> 40 sections vendored from `avniproject/avni-ai/dify/merged.md` (branch `app-configurator-dev`).
> Regenerate via `node scripts/build-implementer-reference.mjs` when upstream changes.

---

## `readme/Implementers/advanced-feature-guide/about-audit-information.md`

title: About Audit Information
excerpt: ''
In Avni mobile app the user can see certain audit information. The app displays:

1. Created by user for subjects and program enrolments.
2. Filled by user for program encounters and general encounters. This is the user who filled the form. For scheduled encounters - this is the person who filled the form and not the person who was instrumental in scheduling the encounter.
3. Where ever the audit information is not available (see below), no audit information will be shown. In other words if the audit information is not shown then it will be due to the following.

### When is the audit information not shown.

1. Since this feature has been introduced only now, release 7.0, all audit information are not available for older records and it will start showing up only for the newer records.

---

## `readme/Implementers/advanced-feature-guide/access-control.md`

title: Access Control
excerpt: ''
Before the introduction of Access Control, organisation users with access to the field app could access all functions (i.e. registration, enrolments, search etc.) in the app. There was a need for some implementations to limit access to specific functions in order to reduce the number of options visible to end users and simplify the workflow for them while also providing a mechanism for access control.

Access Control is implemented via User Groups to facilitate this need. This functionality is available to Organisation admins in the Admin section of the Web app under the User Groups menu.

# Applicability

* The access control rules are applicable in the field app, data entry app, and the web app.
* Access control is not applicable to the reporting app.

# User Groups

User Groups represent a collection of users and a set of privileges allowed to these users. User with EditUserGroup and EditUserConfiguration privilege can define as many groups as they need to define the access control required for their organisation. Each group can be assigned a set of privileges (or all privileges using the switch available at the top).

Each user can be added to multiple groups.

## Privileges are Additive

If any of the groups that a user belongs to allows a particular privilege, the user will have access to that function.

## Default Groups

By default, the system creates an `Everyone` and an `Administrators` group. `Everyone` group includes all the users in the organisation. `Administrators` group grants all the privileges to allow access to all the functionality.

<Image align="center" width="500px" src="https://files.readme.io/9c003c1-Screenshot_2023-08-08_at_3.46.23_PM.png" />

Users cannot be removed from `Everyone` group but the privileges associated with this group can be modified. The has all privileges flag cannot be reset for `Administrators` group.

## Privileges

The following privileges are available in order to allow organisation admins to configure fine-grained access to functions for the org users. These privileges are configurable per entity type i.e. a group could have the 'View subject' privilege allowed for subject type 'abc' but disallowed for subject type 'xyz'.

* The Subject level privileges are configurable for each Subject Type setup in your organisation.
* The Enrolment level privileges are configurable for each program setup in your organisation.
* The Encounter level privileges are configurable for each Encounter Type (General or Program) setup in your organisation.
* The Checklist level privileges are configurable for each Program containing checklists for your organisation. 

<Table align={["left","left","left"]}>
  <thead>
    <tr>
      <th>
        Entity Type
      </th>

      <th>
        Privilege
      </th>

      <th>
        Explanation
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        Subject
      </td>

      <td>
        View subject
      </td>

      <td>
        Controls whether field users can see subjects of a particular subject type in the app.  

        All other privileges are dependent on this privilege. If disallowed, field users cannot see or access any functionality for the specific subject type.
      </td>
    </tr>

    <tr>
      <td>
        Subject
      </td>

      <td>
        Register subject
      </td>

      <td>
        Allows field users to register new subjects.
      </td>
    </tr>

    <tr>
      <td>
        Subject
      </td>

      <td>
        Edit subject
      </td>

      <td>
        Allows field users to edit previously registered subjects.
      </td>
    </tr>

    <tr>
      <td>
        Subject
      </td>

      <td>
        Void subject
      </td>

      <td>
        Allows field users to void previously registered subjects.
      </td>
    </tr>

    <tr>
      <td>
        Subject
      </td>

      <td>
        Add member\*
      </td>

      <td>
        Allows field users to add a member to household subject.
      </td>
    </tr>

    <tr>
      <td>
        Subject
      </td>

      <td>
        Edit member\*
      </td>

      <td>
        Allows field users to edit previously added household members.
      </td>
    </tr>

    <tr>
      <td>
        Subject
      </td>

      <td>
        Remove member\*
      </td>

      <td>
        Allows field users to remove previously added household members.
      </td>
    </tr>

    <tr>
      <td>
        Enrolment
      </td>

      <td>
        Enrol subject
      </td>

      <td>
        Allows field users to enrol a subject into a program.
      </td>
    </tr>

    <tr>
      <td>
        Enrolment
      </td>

      <td>
        View enrolment details
      </td>

      <td>
        Allows field users to view the program enrolment details for a subject.
      </td>
    </tr>

    <tr>
      <td>
        Enrolment
      </td>

      <td>
        Edit enrolment details
      </td>

      <td>
        Allows field users to edit the program enrolment details for a subject.
      </td>
    </tr>

    <tr>
      <td>
        Enrolment
      </td>

      <td>
        Exit enrolment
      </td>

      <td>
        Allows field users to exit a subject from a program.
      </td>
    </tr>

    <tr>
      <td>
        Encounter
      </td>

      <td>
        View visit
      </td>

      <td>
        Allows field users to view encounters for a subject.
      </td>
    </tr>

    <tr>
      <td>
        Encounter
      </td>

      <td>
        Schedule visit
      </td>

      <td>
        Allows field users to schedule encounters for a subject.
      </td>
    </tr>

    <tr>
      <td>
        Encounter
      </td>

      <td>
        Perform visit
      </td>

      <td>
        Allows field users to perform encounters for a subject.
      </td>
    </tr>

    <tr>
      <td>
        Encounter
      </td>

      <td>
        Edit visit
      </td>

      <td>
        Allows field users to edit previously saved encounter details.
      </td>
    </tr>

    <tr>
      <td>
        Encounter
      </td>

      <td>
        Cancel visit
      </td>

      <td>
        Allows field users to cancel a previously scheduled encounter.
      </td>
    </tr>

    <tr>
      <td>
        Encounter
      </td>

      <td>
        Void visit\*\*
      </td>

      <td>
        Allows field users to void an encounter
      </td>
    </tr>

    <tr>
      <td>
        Checklist
      </td>

      <td>
        View checklist
      </td>

      <td>
        Allows field users to view checklist.
      </td>
    </tr>

    <tr>
      <td>
        Checklist
      </td>

      <td>
        Edit checklist
      </td>

      <td>
        Allows field users to edit checklist.
      </td>
    </tr>
  </tbody>
</Table>

`*` Only for 'Household' subject types

`**` Only available as part of Avni 4.0 release (not a full list)

Some of these privileges imply others. For example, allowing the 'Register Subject' privilege implies that the group will also have 'View Subject' allowed. The system handles these dependencies automatically.

## What if I have a simple setup with no separate users?

You can add all your users to the `Administrators` group.

## Is some data with no access control?

Yes some of the app designer and admin user interface (or non-operational data) is open to all users with read access. This data is not confidential in any of the implementations of Avni, hence this has been kept open for any user with login to the organisation.

## Can users update metadata using the API

No, the server also check for the access privileges of the user.

## Super admin access

Access of super admin is restricted to non-operational data of the organisations. Operational data cannot be viewed as well by super admin. This is to provide visibility to the organisations about who can view their data.

---

## `readme/Implementers/advanced-feature-guide/app-storage-management-and-sync-disable.md`

title: App Storage Configuration and Disable Sync
excerpt: ''
### Need

After an organisation has run Avni for a few years, the amount of data collected over time can be sizeable depending on the scale of the program, number of subjects registered, number of times they were visited etc. Depending on the program objectives and especially for organisations where catchment based division of data is not used or is not effective, all of this historical data may not be of use to a field user who has just joined the organisation and is starting to use Avni. This unnecessary data causes longer initial sync time, slower dashboard loads and increases the storage used by the Avni app on the user's device.

### Solution

In order to address this, implementers can now configure an SQL query which returns the subject ids of subjects which should be disabled from being synced when a sync from the android app is performed.

This configuration can be made via the 'App Designer -> [App Storage Config](https://app.avniproject.org/#/appdesigner/appStorageConfig)' menu. This query is validated to ensure it returns a single numeric column (the subject id) as output.

The query configured via this screen is picked up by a job that runs on a daily basis (configured to run at 2AM IST) which finds subjects based on this query and disables **subsequent sync to android app on user devices** for these subjects and the related entities for these subjects (visits, program visits, entity approval status, subject migration, user subject assignments, relationships, groups, checklists, comments, subject program eligibility etc).

### Example

To disable sync for subjects that were created more than 2 years ago, the query would look like:

`select i.id from public.individual i where i.created_date_time < now() - interval '2 years';`

Remember that this job runs every night so it will keep disabling sync for records that match the criteria on a continuing basis if the condition specified in the query is relative.

### Notes

1. If the subjects (and related entities) are already present on the user device (from a previous sync or via fast sync etc), they are not deleted from the device and the user will be able to view and update them. Updates made to such subjects on the android app will be updated on the server when synced. Other users with access to these subjects will however, not receive these updated records on the android app when they sync.
2. Dashboards on the android app may differ between users having the same sync settings depending on when the respective users synced.
3. DEA users will continue to see these records and will be able to update them and see the updates.
4. No impact to existing reports and exports (sync disabled records will be included).
5. There are constraints in place to prevent the sync disabled value for related entities from becoming different from the sync disabled field for the subject. In order to prevent sync errors, `sync_disabled` should never be updated via SQL query for any entity.
6. Writing a query that looks up tables from the ETL org-specific schema might not have the intended result as the ETL schema is not guaranteed to be in sync with the public schema when the job executes.

---

## `readme/Implementers/advanced-feature-guide/application-menu.md`

title: Application Menu items
excerpt: ''
The customizable "Application menu" feature helps you add a new menu item that will show up on the "More" option of the Android app. 

This new menu item can either be an http link, or a whatsapp number. Popular apps that can be used with this linking scheme are available [here](https://gist.github.com/imbudhiraja/5b0a485fb7f36fb16c9d7d5f19b6ee40)

eg: 

* To open Whatsapp for a number, you would use a url like "whatsapp\://send?text=hello\&phone=xxxxxxxxxxxxx"
* To open a link on youtube, you would use this - youtube://watch?v=dQw4w9WgXcQ
* To open the Avniproject website on the browser, you would use [https://avniproject.org](https://avniproject.org)

### Configuration

In order to set this up, add a row to the menu\_item table. 

```sql Add new menu iterm
INSERT INTO public.menu_item (organisation_id, uuid, is_voided, version, created_by_id, last_modified_by_id,
                              created_date_time, last_modified_date_time, display_key, type, menu_group, icon,
                              link_function)
VALUES (156, uuid_generate_v4(), false, 0, 1, 1, '2022-08-25 11:05:57.791 +00:00',
        now(), 'Support', 'Link', 'Support', 'whatsapp',
        '() => "whatsapp://send?phone=+919292929292"');
```

The link\_function is a function that can create a dynamic url. See [here](https://avni.readme.io/docs/writing-rules#12-hyperlink-menu-item-rule) for more information on how these functions can be written.

---

## `readme/Implementers/advanced-feature-guide/approval-workflow.md`

title: Approvals
excerpt: ''
Avni gives you the ability to review data filled by the field users using approval workflow. Data of each form can be reviewed by the supervisor and comments can be provided to correct the data. Even field users can track what all data filled by them was approved or rejected.

Approval can be configured separately for following Avni entities:

* Individual
* Encounter
* Program Enrolment
* Program Encounter
* Checklists

## Enabling approval workflow

You can enable approval workflow for your organization using the "App Designer" app. Simply go to "Forms" tab and search for the relevant form corresponding to the Entity of interest. Ex: To enable workflow for Subject Type "Demand", we would be clicking on the Gear icon for "Subject Registration" row for Subject "Demand".

<Image alt="Click on Gear Icon of the " align="center" src="https://files.readme.io/1ab51a8-Screenshot_2023-05-31_at_3.09.59_PM.png">
  Click on the "Gear Icon" of the "Subject Registration" Form
</Image>

After that toggle the  "Enable Approval" button to enable / disable the Approval workflow specific to the Entity. Avni gives you the ability to enable this feature at each form level. So if you want you can enable it for some forms and disable it for others.

<Image alt="Toggle the &#x22;Enable Approval&#x22; button" align="center" src="https://files.readme.io/a5e98cf-Screenshot_2023-05-31_at_3.07.47_PM.png">
  Toggle the "Enable Approval" button
</Image>

Apart from enabling the feature we also need to create a custom dashboard so that we can track which all forms are pending, approved, and rejected. You can also mark this dashboard as the primary dashboard from the admin app -> "user groups" -> "dashboard".

<Image title="da.png" alt={1845} align="center" src="https://files.readme.io/a72577b-da.png">
  Approval dashboard to track the forms filled by the field users. All these are standard cards and no custom query is required.
</Image>

Once the approval dashboard is ready and approval workflow is active, every time user fills a form it'll be visible under pending items in the dashboard. The supervisor/reviewing person can review these pending forms and can either approve or reject them. If rejected, the field user will see the rejected form under rejected items and can correct the entries in the form based on the rejection comment provided by the supervisor. After correction, the form will again go for approval and once it is approved it'll start showing under approved items.

<Image title="ada.png" alt={572} align="center" src="https://files.readme.io/e85a870-ada.png">
  Approval dashboard showing pending, approved, and rejected forms.
</Image>

<Image title="ar.png" alt={567} align="center" src="https://files.readme.io/71d38c6-ar.png">
  The supervisor can approve or reject a form after reviewing the details.
</Image>

<Image title="rc.png" alt={576} align="center" src="https://files.readme.io/730dc72-rc.png">
  A rejection comment can be provided to the field user using which they can correct the information.
</Image>

Please note that you can tract the forms only when the approval workflow feature is turned on. If you turn off this feature in between then all the forms filled after that will not get tracked.

### Updates to the Approval Status UI (in development)

Approval items will be grouped by Subjects and arranged in alphabetical order.

[https://github.com/avniproject/avni-client/releases/download/untagged-ccaaf92c54fc9ece8238/Screen.Recording.2023-12-12.at.3.36.38.PM.mov](https://github.com/avniproject/avni-client/releases/download/untagged-ccaaf92c54fc9ece8238/Screen.Recording.2023-12-12.at.3.36.38.PM.mov)

![]()

---

## `readme/Implementers/advanced-feature-guide/bulk-data-upload-v2.md`

title: Bulk Data Upload v2
excerpt: applicable release 13.0 onwards
## Purpose

* Prepare data in bulk, review, and upload.
* Migrating away from an existing implementation, and need to seed with existing data.
* Your organization has a separate component where data is collected outside Avni, but you still need this data to be present with field workers using Avni.

## Using the Admin app to upload data

The Admin app of the web console has an upload option. Currently, this supports the following. Essentially for each form present in you organisation there is a corresponding upload option in the dropdown, with a sample file.

* Upload subjects
* Upload program enrolment (excluding exit information and observations)
* Upload program encounters (excluding cancel information and observations)
* Upload encounters (excluding cancel information and observations)
* [Upload locations](location-and-catchment-in-avni)
* Upload users and catchments
* Upload metadata zip file downloaded from a different implementation

## Sample file

Sample files are available in the interface. Download the file, fill in values and then upload. The file is in a [CSV](https://www.howtogeek.com/348960/what-is-a-csv-file-and-how-do-i-open-it/) format.\
Sample file acts as an up-to-date documentation on the following.

* fields
* whether they are mandatory for upload
* possible values
* format of the value

> 📘 Since above has already been documented and maintain in the sample file these are not documented here again, please refer to it as a reference documentation.

## Mandatory fields in the form

The mandatory fields in the form element are not applicable when uploading the data via CSV files - since we have seen when made mandatory especially for the legacy data, the users are force to upload some junk information (this may be added in the future).

## Rules

No rules are run as part of CSV upload. This implies that:

* field values created automatically via form element rules will not get created (such columns are present in the sample hence can be uploaded manually)
* observations created by decision rules will not be created automatically (such columns are present in the sample hence can be uploaded manually)
* Validation rule is not applied
* Edit rule is not applied

> 📘 Avni currently doesn't have a robust framework to run these rules on the server side. This may be added in future, if we observe that users need these.

## Identifiers

The primary purpose of these identifiers is for the users to be able to link different CSV file types upload data to each  other - in the same way as foreign key linkages between different records. These linkages can be created using identifiers of user's choosing. Lets try to understand this via an example. Lets assume there are three forms.

* Woman Registration (Subject)
* Pregnancy Program Enrolment (Program Enrolment)
  * links to woman
* Ante Natal Visit Form (Program Encounter)
  * links to pregnancy program

<Table align={["left","left","left"]}>
  <thead>
    <tr>
      <th>
        Form
      </th>

      <th>
        Columns
      </th>

      <th>
        Description
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        Woman Registration
      </td>

      <td>
        Id from previous system
      </td>

      <td>
        Any unique identifier that you may want to use. Note that you can make this up if you don't already have one. e.g. WOMAN-100001, WOMAN-100002
      </td>
    </tr>

    <tr>
      <td>
        Pregnancy Program Enrolment
      </td>

      <td>
        Id from previous system
      </td>

      <td>
        Any unique identifier that you may want to use. It should unique for all program enrolments. They can be same as woman registration id, but we recommend you use something like e.g. WOMAN-100001-01, WOMAN-100001-02 so that you can use multiple enrolments for the same woman.  

        It is possible that at the time of preparing this data, you are don't plan to upload woman registration via CSV and it is already present in Avni. In such a case you should use the Avni UUID value of the woman registration in this field.
      </td>
    </tr>

    <tr>
      <td>
        Pregnancy Program Enrolment
      </td>

      <td>
        Subject Id from previous system
      </td>

      <td>
        This should be used to match the pregnancy enrolment record woman registration record. Hence, for our example used so far, this field would have values like - WOMAN-100001, WOMAN-100002
      </td>
    </tr>

    <tr>
      <td>
        Ante Natal Visit Form
      </td>

      <td>
        Id from previous system
      </td>

      <td>
        You can leave this blank, if you intention is to create new records only and not edit them.
      </td>
    </tr>

    <tr>
      <td>
        Ante Natal Visit Form
      </td>

      <td>
        Program Enrolment Id
      </td>

      <td>
        This should be used to match the program ante natal visit form record with woman registration record. Hence, for our example used so far, this field would have values like - WOMAN-100001-01, WOMAN-100002-01  

        It is possible that at the time of preparing this data, you are don't plan to upload pregnancy enrolment data via CSV and it is already present in Avni. In such a case you should use the Avni UUID value of the woman registration in this field.
      </td>
    </tr>
  </tbody>
</Table>

> 📘 The identifiers used above, for Id from previous system, are saved in Avni but is not visible in Avni after uploading, it is used only for matching records during CSV upload.

## Scheduling a visit and Upload visit details

Please note that sample file for uploading visit details and scheduling a visit are different. These two options allow for  either creating a scheduled encounter/visit or completed encounter/visit. Note that scheduling a visit and then uploading the visit details for the same visit is not supported (as that is similar to edit).

<Image align="center" className="border" border={true} src="https://files.readme.io/30f7062dbe6572554955d88df13530e6e45c5a4cd5986fd81499661a294f78a2-image.png" />

## Important Notes / Gotchas

* **Limited Concept Support in CSV Upload**: Not all concepts are supported when uploading data via CSV. Specifically, the following are not supported:
  * GroupAffiliation
  * Id
  * File
* **Id Confusion**: The identifiers (used in Id from previous system) are different from Id elements in the form, if you have them.
* **Form Data Editing**: Editing previously submitted form data is not currently supported through the CSV upload process.

# Questions

### What if I have a comma in my observation value?

* Wrap your value in quotes.

### Why are decision concepts not appearing the sample file

If you are using decision concepts in the rule but not linked those concepts then this will happen.

### Is the order of values important?

* No. Columns can be in any order.

### How do I upload images?

* For images, use a url that the avni server can download. Ensure that
  * The images are a direct download link (not a redirect to a page that uses javascript to download)
  * The image urls end with the image type. eg: [https://somedomain.com/images/abc.png](https://somedomain.com/images/abc.png)

---

## `readme/Implementers/advanced-feature-guide/call-masking.md`

title: Masked Calls
excerpt: ''
When a contact number is configured in an implementation (through concept attributes), then the user gets a "Call" button on the subject's dashboard. It is used to open the dialler and make a call to the beneficiary.

With the call masking feature, an implementation can choose to convert this call button into a masked call. There is a user settings toggle to turn this on or off. Under the wraps, Avni can use the Exotel Masked Call feature to make this happen. 

To use this feature, a user needs to purchase an Exophone and configure this in Avni. Configuration is currently done by adding a row to the external\_api table. 

### User flow

* User goes to a subject's dashboard.
* User clicks on the call button
* If call masking is enabled for this user, then the call button makes a call to the server to connect their phone to the beneficiary's number. The user and the beneficiary will get a call from Exotel through which they can talk.
* The user gets a message that the call request was made successfully, and to wait for a call back.
* If call masking is not enabled for this user, then the call button makes a direct call through the dialler.

---

## `readme/Implementers/advanced-feature-guide/child-growth-charts.md`

title: Growth Charts in Avni
excerpt: ''
## Introduction to Child Growth Indicators

Growth charts are essential tools for monitoring the physical development of children. They help healthcare providers assess whether a child is growing properly according to established standards.

Refer to WHO's [child-growth-standards](https://www.who.int/tools/child-growth-standards/standards) for in-depth coverage on all indicators used to assess the growth of a child. These indicators are intended for interpretation primarily by healthcare providers to:

* Investigate causes of growth problems 
* Counsel caregivers on recovery 
* Intervene in urgent high-risk scenarios to avert permanent damage or mortality

The child's age, sex, and measurements of weight and length or height are used to calculate the following growth indicators as per WHO standards for children aged 0 to 5 years:

* **Weight-for-age (WFA)**: Helps identify underweight or overweight conditions
* **Length/height-for-age (HFA)**: Helps identify stunting (low height for age)
* **Weight-for-length/height (WFH)**: Helps identify wasting (low weight for height) or obesity

These measurements should be taken and recorded whenever an infant or child visits a healthcare provider, such as for immunization, well-baby visits, or care during illness.

## Growth Chart Features in Avni

### Supported Indicators

The Avni client application provides growth charts for the following indicators by default:

* Weight-for-age (WFA)
* Length/height-for-age (HFA)
* Weight-for-length/height (WFH)

### Automatic Enablement

In Avni, growth chart monitoring is automatically enabled when a program with the name "Child" or "Phulwari" is created for an organization.

### Manual Enablement

For any other Program, Growth Chart monitoring can be enabled by toggling the "Show Growth Chart" widget to the Program Dashboard.

<Image align="center" src="https://files.readme.io/8e5736a641553e404b24d0ef935974afe08256a0d1a549e3f4e16d22c743bbb8-Screenshot_2025-05-29_at_6.16.30_PM.png" />

### Required Configuration

It is essential for at least a few forms of the types listed below to include concepts with the names **"Weight" and "Height"**. The values recorded for these concepts are then automatically used by the Avni application to plot the Growth Charts.

* Individual   
* Program  
* Program-Encounter     
* Encounter 

## Accessing Growth Charts

Growth Charts are available only in the Avni Client application for:

* Individuals between ages 0 to 5 years AND
* Individuals enrolled in either a program named "Child" or "Phulwari" OR any other Program that has the "Show Growth Chart" widget enabled for it

For eligible children, a "Growth Chart" button will appear on the Program Dashboard.

<Image alt="Growth Chart Button on Dashboard" align="center" width="320px" src="https://files.readme.io/16d426511ff8c27feacc0843fa7a88b1d4fd04e7af7b120fc3897146acc304c1-Screenshot_2025-05-29_at_6.29.01_PM.png">
  Screenshot showing the Growth Chart button on the Program Dashboard
</Image>

Clicking the "Growth Chart" button displays the growth chart with selector buttons at the top, allowing users to choose which specific growth indicator to display for that child.

<Image alt="Weight-for-Age Chart" align="center" width="320px" src="https://files.readme.io/4c985dc341f4e6e2548e784d742da8fba12de51699cdd7487f64f48482bf18a6-Screenshot_2025-05-29_at_6.28.39_PM.png">
  Screenshot of Weight-for-Age growth chart
</Image>

<Image alt="Height-for-Age Chart" align="center" width="320px" src="https://files.readme.io/e0d418b61e5fbd95c51651467c2c3f23f086021fea95bb9ed3ee5eda5a7b3575-Screenshot_2025-05-29_at_6.28.47_PM.png">
  Screenshot of Height-for-Age growth chart
</Image>

<Image alt="Weight-for-Height Chart" align="center" width="320px" src="https://files.readme.io/70cbcdfe31ed6d76c00445dadbfa747db32e6b75af17d9c1cd07c681abbcd262-Screenshot_2025-05-29_at_6.28.51_PM.png">
  Screenshot of Weight-for-Height growth chart
</Image>

## Understanding Growth Charts

### Chart Components

* **Reference Lines**: Standard deviation lines (typically -3SD, -2SD, -1SD, Median, +1SD, +2SD, +3SD) showing expected growth ranges based on WHO standards
* **Data Points**: Plotted points representing the individual's measurements at different ages
* **Connecting Line**: Line connecting the individual's data points to show growth trajectory
* **X-Axis**: Typically represents age in months/years
* **Y-Axis**: Represents the measurement value (weight, height, etc.)

### Color Indicators

Growth Charts use color coding to help quickly identify growth status:

* **Red Zone**: Indicates measurements below -3SD (severe malnutrition or growth faltering)
* **Yellow/Orange Zone**: Indicates measurements between -2SD and -3SD (moderate malnutrition)
* **Green Zone**: Indicates measurements above -2SD (normal/healthy ranges)

## Interpreting Growth Charts

When viewing a growth chart in Avni:

### Weight-for-Age (WFA)

* Measures overall growth and can identify underweight children
* Below -2SD: Moderately underweight
* Below -3SD: Severely underweight
* Current Status: The position of the most recent data point relative to reference lines indicates current nutritional status

### Height-for-Age (HFA)

* Measures linear growth and can identify stunting
* Below -2SD: Moderately stunted
* Below -3SD: Severely stunted
* Growth Trajectory: The direction of the connecting line shows if height growth is improving, maintaining, or declining

### Weight-for-Height (WFH)

* Measures body weight relative to height and can identify wasting
* Below -2SD: Moderate wasting
* Below -3SD: Severe wasting
* Above +2SD: Overweight
* Above +3SD: Obese
* Pattern Recognition: Multiple data points help identify patterns like wasting or weight gain relative to height

## Using Growth Chart Data for Interventions

Based on the growth chart visualization, field workers can:

1. **Identify Growth Patterns**:
   * Normal growth: Data points consistently follow a growth channel
   * Growth faltering: Flattening or downward trajectory of the curve
   * Catch-up growth: Upward trajectory after a period of growth faltering

2. **Take Appropriate Actions**:
   * Normal Growth: Continue regular monitoring and standard care
   * Moderate Concerns (between -2SD and -3SD): Implement nutritional counseling and follow-up monitoring
   * Severe Concerns (below -3SD): Refer for specialized care, nutritional interventions, or further assessment

## Technical Implementation Details

* Growth charts are dynamically rendered based on recorded encounter data
* Charts require accurate recording of birth date and measurement values
* Reference data follows WHO Child Growth Standards
* Charts are available offline once data is synced to the device
* The implementation follows Avni's offline-first architecture, ensuring charts are available even without internet connectivity
* Data points are automatically plotted based on encounter data containing Weight and Height measurements
* Growth charts interface adapts to different screen sizes on mobile devices

## Troubleshooting

If growth charts are not displaying correctly:

1. Verify that concepts named exactly "Weight" and "Height" are included in encounter forms
2. Ensure measurements are recorded in the correct units (kg for weight, cm for height)
3. Confirm the child's date of birth is recorded accurately. Current implementation supports display of Growth Chart only for children aged 0-5 years
4. Check that multiple encounters with measurements exist for proper trend visualization
5. Sync your device to ensure you have the latest program configuration
6. Verify that the program name is either "Child" or "Phulwari" to enable Growth Chart functionality automatically. For other programs, Growth Chart functionality can be enabled by toggling the "Show Growth Chart" widget to the Program Dashboard

## Summary

Avni's Growth Chart functionality provides a powerful tool for field workers to monitor and assess child growth in accordance with WHO standards. The offline-first implementation ensures that these critical assessment tools are available even in areas with limited connectivity, aligning with Avni's core mission of supporting field workers in remote areas.

By following the simple configuration requirements and understanding how to interpret the charts, organizations can effectively track child growth and development, enabling timely interventions when needed.

---

## `readme/Implementers/advanced-feature-guide/comment-workflow.md`

title: Comment workflow
excerpt: ''
This is an issue resolution mechanism provided by Avni which helps to fix the mistakes in the record. Comment workflow helps to pinpoint the exact subject for which data correction is required. This saves a lot of time the user spends searching for that subject.

## Enabling comment workflow

Comment workflow can be enabled from the admin app. Simply go to organisation details and switch on "enable comments" option.

<Image title="comment.png" alt={1848} src="https://files.readme.io/548038c-comment.png">
  Enable comments option in the admin app
</Image>

Once this feature is enabled users will start seeing the comment icon on the subject dashboard. They can click on the icon to open all the comment threads of the subject. They can perform the following operations on the comment screen.

* Open a comment thread and read all the comments on that thread.
* Reply to a comment thread.
* Mark a comment thread as resolved, if the issue is resolved.
* Open a new comment thread by pressing add icon.

<Image title="comment screen.png" alt={574} src="https://files.readme.io/f1a3a13-comment_screen.png">
  Comment screen showing one open thread. Users can see all the comments in a thread by clicking on that thread.
</Image>

**Useful tips** 

* When comment workflow is enabled, ensure that a standard report card of type "comments" is added to the dashboard. This will help users to see only the comments threads which are open and they need to work on.

---

## `readme/Implementers/advanced-feature-guide/creating-identifiers.md`

title: Autogenerated Ids
excerpt: ''
    - type: basic
      slug: upload-checklist
      title: Upload checklist
---
### Identifiers

Identifiers are unique strings generated by the system, which can be used to identify a beneficiary. Usually, these have special patterns - prefixes, suffixes, special numbering patterns etc, which aid users in understanding a beneficiary. 

### ID Generation in Avni

In usual systems, identifiers are generated from a central place because we need them to be unique. However, the Avni Android app is expected to work offline. Offline ID generation is possible, but is done differently. IDs in Avni are generated in batches and sent to a user. 

There is a special form element type called ID. If you configure a form element to be of ID type, then the Avni android app will automatically retrieve the next ID from this batch and assign it as the value. 

*Advanced* - It is also possible to create rules that modify the final ID that is stored for the beneficiary. For example, if there is the need of adding a date to the final ID being generated, you would write a ViewFilter rule that will use the generated ID and append a date to it. 

### Identifier sources

It is possible to have multiple IDs being generated at the same time. Each ID type is called an identifier source. An identifier source will have a certain type (discussed later), prefix (optional), minimum and maximum lengths and can be assigned to a  catchment.\
The type of an identifier source determines the strategy used to generate IDS of that source. There are currently two types available. The only difference between them is the place where the prefix is stored. 

1. User pool based identifier generation - Here, a pool of users within a catchment share the same prefix. The prefix is stored within the identifier source within options. Every user asking for ids is provided with a set of ids prefixed with this value. 
2. User based identifier generation - Here, the prefix is stored in the "idPrefix" value of the user's settings.

### Rules

1. User pool based identifier generation - overlaps in ID for the same identifier source not allowed.
2. User based identifier generation - Two users in the same organisation cannot have same prefix. This check is case in-sensitive.

Queries to analyse existing data is available here - [https://github.com/avniproject/avni-webapp/issues/1022#issuecomment-1693064436](https://github.com/avniproject/avni-webapp/issues/1022#issuecomment-1693064436)

### Tutorial

#### 1. Create Identifier Source from admin section:

1. Give name
2. Choose type - User pool based identifier generator or User based identifier generator. Difference between the two is explained above.
3. Choose catchment
4. Choose batch generation size. This is the number of identifiers that will be generated at once and be sent to client app on sync. If your field users can not sync for a long time then you should estimate how many identifiers they may need.
5. Choose minimum balance. This is useful to make sure that your users get a warning to sync before they run out of identifiers.
6. Choose Min length and max length. This specifies the min and max length of the generated identifiers.
7. You will get an option to add Prefix if you chose User Pool Based Identifier Generator in the Type field(1.2). This prefix will be shared by all identifiers generated for users sharing the same identifier source.

#### 2. Create Identifier User Assignment from admin section:

1. Choose User. The user that you select will start getting auto-generated ids  once they Sync.
2. Choose Identifier Source. This is the resource that you created in Step 1 above(Create Identifier Source from admin section).
3. Enter initial identifier to be generated for this user. It should also include the prefix. E.g. if you had set the prefix to be ANC and min length to be 3, and you want the identifiers to start from 100 then the value of this field could ANC100.
4. Enter last identifier to be generated for this user. System will not generate any identifiers beyond this. E.g. If your prefix is ANC, max length is 4 and you want identifiers only till 2000 then this could be ANC2000.

#### 3. Create a question in the form with concept type Id

1. In the form where you want the auto generated identifier, do create a question with concept type Id and select the identifier source.

---

## `readme/Implementers/advanced-feature-guide/custom-fields-in-search-results.md`

title: Custom fields in search results
excerpt: ''
Avni app has the capability to setup [custom search filters](https://avni.readme.io/docs/my-dashboard-and-search-filters), but the results do not show any of these fields. Using this feature one can add additional fields to the search result.

## Setting up custom fields in search results

1. In the app designer go to Search Result Fields and select the subject type for which you want to setup the custom search result fields.
2. Next From the dropdown choose the concept name.
3. You can reorder the custom search fields by drag and drop and finally save the changes.
4. Sync the mobile app and you should see the newly added concept in the search result field.

![1031](https://files.readme.io/8c14b56-custom-search-result-fields2.gif "custom-search-result-fields(2).gif")

**Note**: Only concepts in the registration form are supported.\
**Supported data types**: Text, Id, coded, numeric, and date.

---

## `readme/Implementers/advanced-feature-guide/documentation.md`

title: Form Documentation
excerpt: ''
Custom documentation can be created in Avni. Documentation supports rich text and can be written in different\
languages supported by an organization. Right now you can also link particular documentation to a form element and it'll show up in the mobile app. This is useful where more context is required for any question.

## Steps to configure and link documentation

The below GIF displays how documentation can be created and linked to a form element.

<Image title="Documentation-linking.gif" alt={1851} src="https://files.readme.io/d2a237f-Documentation-linking.gif">
  Configuring and linking documentation
</Image>

Once documentation is linked to the form element, it'll start appearing in the mobile app. Users can expand and close the documentation while filling out the form.

<Image title="form-element-documentation.png" alt={568} src="https://files.readme.io/542e811-form-element-documentation.png">
  Documentation on the mobile app.
</Image>

---

## `readme/Implementers/advanced-feature-guide/draft-save.md`

title: Draft save
excerpt: ''
Sometimes we have huge forms and all the information is not available when you start capturing the data of such forms. Avni gives you the facility to save the half-filled form as a draft. These draft forms are not synced to the server, and once you fill the form completely draft is automatically deleted.

## Enabling Draft save

You can enable draft to save for your organization using the admin app. Simply go to "organisation Details" and enable "Draft save".

![](https://files.readme.io/d824dc2-draft_save.png "draft save.png")

Once the "draft save" feature is enabled you can see the half-filled forms in the registration tab in the field app. Please note that these drafts will get if the draft is left untouched for more than 30 days.

It gets converted into a regular Subject or Encounter on pressing Save button during modification of a draft.

![](https://files.readme.io/8386271-d.png "d.png")

## Key points

* **Applicability:** Currently, this feature works only for the registration and encounter forms. So Program enrolment and program encounter forms won't get saved as a draft if left in middle.
* **Display:** Registration drafts are displayed on the Register screen. Encounter drafts are displayed under the on the 'General' tab on the Subject Dashboard. Unscheduled encounter drafts are displayed under the 'Drafts' section and scheduled encounter drafts are accessible by tapping 'Do' on encounters under the 'Visits Planned' section.
* **Save Checkpoint:** A draft save action is performed on clicking "Next" or "Previous" buttons while filling in a form, therefore, if User fills in a page but does not click on "Next" or "Previous" buttons, then the Draft saved would have content only till the previous page (On which "Next" button was clicked)
* **Exiting a form:** To exit from a form in-between, user may click on the "Header" "Back" button or click on "Footer" "Home" buttons\*\*
* **Stale Drafts clean-up:** Usually drafts get deleted once you perform a final save operation to convert it to an actual entity. Along with that we have a periodic drafts clean-up which gets executed once a day, to delete drafts that were last updated more than 30 days ago.

---

## `readme/Implementers/advanced-feature-guide/encryption-of-data-on-the-android-app.md`

title: Encryption of data on the Android app
excerpt: ''
Some implementations require a higher level of security, which includes encryption of the database on Android. 

### How to enable encryption:

To have all the users field app database encrypted, the option for encryption need to be enabled under `Organisation Details`  as shown in the image below. Users would be in need to sync the app, to reflect the encryption setting change.

<Image align="center" src="https://files.readme.io/e132e70-Screenshot_2023-08-14_at_4.24.22_PM.png" />

### Side-effects of using the feature:

* As shown in the warning message in the image above, enabling this feature will not permit the user to use [fast sync](https://avni.readme.io/docs/fast-sync) and upload db feature from the Menu options on the field app.
* After the option is enabled, it can be disabled anytime on change of mind. 

### Developer debug notes:

* To see the data of encrypted realm db, print out the commented out line that calculates `hexEncodedKey` in the `EncryptionService`. And use the printed value to open the realm db when it asks for the encryption key as shown in the image below.

<Image align="center" src="https://files.readme.io/e79ad32-Screenshot_2023-08-09_at_4.41.56_PM.png" />

---

## `readme/Implementers/advanced-feature-guide/etl-schema-and-reporting.md`

title: ETL schema, reporting and management
excerpt: ''
The public datamodel is not suited for easy reporting because of a few reasons. 

1. jsonb fields 
   1. Cannot be indexed because GIN index and RLS do not work well with each other
   2. Cannot be easily explored because of the way it is setup
2. Analytic queries typically require full table scans, and reducing the data to just one organisation makes it easier
3. Address fields are hierarchical, and are not easy to handle for reports. Especially when we need grouping by different levels of address
4. Many times, pre-created rollups might help make reports easier

### The ETL service

The Avni ETL service fixes the above problems by moving data to a denormalized database that is suited for reporting. It creates tables of the form

* For all subject types, a table called \<subjectType\>
* For all general encounters, a table called \<subjectType\>\_\<encounterType\> and \<subjectType\>\_\<encounterType>\_cancel
* For all programs, a table called \<subjectType\>\_\<programName\> and \<subjectType\>\_\<programName\>\_exit
* For all program encounters, a table called \<subjectType\>\_\<programName\>\_\<encounterType\> and \<subjectType\>\_\<programName\>\_\<encounterType\>\_cancel
* An address table for all addresses
* A media table for all media
* For every Repeatable Question Group present for an entity(Subject, Encounter, ProgramEnrolment or ProgramEncounter), we'll have a separate secondary table called  \<parentTable\>\_\<question\_group\_concept\_name\>

#### Other details of the service

* Data is moved from the public schema to a schema defined by the schemaName of the organisation
* Data is moved incrementally every hour
* Analytics needs to be enabled for an organisation in order for it to work (from the Organisation edit screen of Admin)

### Management of ETL process for an organisation

ETL management for an organisation is only available for support users and not to the users of the organisation itself including administrators. You require super admin login to perform these activities.

* ETL can be enabled or disabled from the organisation edit screen.
* In organisation listing the enable disable status is displayed. One can also open an organisation to check the status. Note: that in listing the status is sometimes shown as blank. This is a defect but we have not been able to fix it. In such a case please check organisation show screen.
* If you want to run the ETL process immediately for an organisation (for which it is already enabled) - then you need to disable and enable. The rescheduling of the job will cause it to run after 10 seconds of enabling.

### Checking error of ETL job of an organisation

GET `{{origin}}/etl/job/{{orgUUID}}` with `auth-token` in header for super admin user.

e.g. [https://app.avniproject.org/etl/job/392bcc3e-0b04-495c-861a-64589d2692b4](https://app.avniproject.org/etl/job/392bcc3e-0b04-495c-861a-64589d2692b4)

You can find replace \\n\\t with newline to get a clearer stack trace.

---

## `readme/Implementers/advanced-feature-guide/extension-points.md`

title: Extensions
excerpt: ''
Extensions are points in Avni where custom html can be used to enhance functionality. There are a few such predefined points where custom html can be inserted. 

In Data Entry App

* Subject Dashboard
* Subject Dashboard for a specific program
* Search Results page

In the Field-App

* Splash Screen

## Creating Extensions

### Creating the extension

In order to create an extension, first you need to create a web app. For each extension point, there will be parameters that you will receive that can be used for custom behaviour. Data can be fetched from the database using the Avni API.

Parameters

* Subject Dashboard - subjectUUIDs (subject's uuid), token (auth token)
* Search Results page - subjectUUIDs (Comma separated list of subjects that have been selected), token
* Splash screen - nothing

The token field must be added as a header AUTH-TOKEN in case you need to use the public API to interact with the Avni server.

### Adding the extension on the App Designer

Extensions can now be added to Avni through the app designer ([https://app.avniproject.org/#/appdesigner/extensions](https://app.avniproject.org/#/appdesigner/extensions)).\
All your extensions must be zipped and uploaded on this screen. You can enter the name of the extension, the file name in the zip file that must be rendered (use relative paths if your HTML file is within a directory), and the type of extension (called Extension Scope). 

![](https://files.readme.io/e772f7d-Screenshot_2021-10-27_at_10.58.02_AM.png "Screenshot 2021-10-27 at 10.58.02 AM.png")

---

## `readme/Implementers/advanced-feature-guide/fast-sync.md`

title: Fast sync
excerpt: ''
When setting up Avni freshly on an android device the first-time sync can take a lot of time, especially if you have a lot of transactional data for the catchment. To make this process faster Avni provides an option to set up fast sync for a catchment.

The performance of syncing data from the server to the local mobile database is dependent on the volume of data - hence cannot be improved significantly. Hence fast sync depends on using the already synced mobile database file as the starting database for other users. This significantly improves the sync duration to less than 5 minutes in most cases.

There are few things to note before we start setting up fast sync.

* Fast sync is set up for a catchment, so if there is a new user in a catchment called "a" then any existing user of the catchment "a" should set up the fast sync from their device.
* Fast sync does not update automatically, which means if the user has set up fast sync one month earlier, then all the data filled after that will get downloaded by the regular sync. So it is recommended to update the fast sync whenever any user is freshly setting up the Avni on their device.
* Fast sync is triggered only when the user is syncing for the first time. So if the user has not logged in for a long time, then it is recommended to delete all the app data and log in again to use the fast sync.

## Setting up fast sync

.Setting up fast sync is very easy and it requires an active internet connection. Existing users can go to "More -> Setup fast sync" and then click "Yes". This will take a while depending on the data in the device. This uploads the database file from the user's device to Avni storage as fast sync file for this catchment.

<Image title="fast sync.png" alt={568} align="center" src="https://files.readme.io/125e0b2-fast_sync.png">
  Fast sync setup option.
</Image>

Once it is done, the new user from the same catchment will get an option to use the fast sync when he logs in for the first time.

<br />

## Verification of Existence of Fast-Sync file

Steps to follow:

1. Figure out Catchment UUID corresponding to the User facing the issue
2. Login into AWS and open up the S3 Console 
3. Navigate to "s3/buckets/\<env\>-user-media/\<org\_media\_bucket\_name\>"
4. There the FastSync files will have prefix of "MobileDbBackup-" followed by Catchment UUID Ex: "MobileDbBackup-b9103c96-7ed7-4798-a866-89419103d361"
5. Download the file and unzip if needed to check size / content

<br />

<Image align="center" src="https://files.readme.io/f6786a7c51e3bdc43bdb24a7960bc74cd7b38af163ec88dc8685f7fe46c395f2-Screenshot_2025-04-03_at_1.14.45_PM.png" />

<br />

## Perils of Fast Sync

"Fast sync" speed up the initial sync and improves new user onboarding experience. But the flip-side of setting up "Fast Sync" are as follows:

* "Fast Sync", if setup using a newer version of app, prevent fresh logins from older version of the app
* "Fast Sync", is setup per Catchment basis, so, if there are restrictions due to Sync-Concept-Values or UserGroup Privileges for one set of users and they have the FastSync Setup for them, then the other set of Users with conflicting Sync-Concept-Values or UserGroup Privileges might end up receiving invalid data / missing data during sync
* "Fast Sync", when setup, assumes that the Catchment constituent Locations are fixed, any change to the catchment results in a "Reset Sync" being created for all users which are associated with that catchment. But new users who get assigned to that Catchment, will not have the "Reset Sync" configured appropriately in all cases, this could result in missed / extraneous data sync happening to the new users.
* "Fast Sync" data cannot be modularly distributed to users of different catchment with overlapping location boundaries. You would have to spearately setup Fast sync for each catchment.
* There is no easy way for Organisation users to remove a "Fast Sync" setup for a Catchment, he should either over-write it with a new "Fast Sync" file, or contact Support team for deletion of old one. To be able to overcome the Sync failure error, you would need to do:
  * Either do "Fresh login" after that(Deletion / overwrite of FastSync file)
  * Or continue and "Perform Slow Sync"

<Image alt="Fast Sync Failure due to Version mismatch" align="center" width="450px" src="https://files.readme.io/a2bce3187fea665854c9d179dc43c9597a0dfff81f3eec23b77626bb5af2aacd-Screenshot_20250410_184143.jpg">
  Fast Sync Failure due to Version mismatch
</Image>

---

## `readme/Implementers/advanced-feature-guide/flavouring-avni.md`

title: Rollout your own Avni App from Play store
excerpt: Branding options available in Avni, and how to proceed
There are can be several reasons for rolling out your own app from the play store.

* You have a different deployment of Avni
* You want your own branding (icons, logos, etc)

You can change the following

1. App logo
2. App name
3. Splash screen (Splash screen is done through [extensions](doc:extension-points))

You may be required to change the following, if your hosting is not managed by Samanvay or not planned to be managed by Samanvay in future.

1. Firebase configuration
2. Bugsnag configuration
   1. Create an account in Bugsnag and create a project of type React Native.
   2. Get the Notifier API key from the project settings

A new app is called a flavor of the app (terminology from [Android flavors](https://developer.android.com/build/build-variants)). There are a few flavors already configured today. This configuration is done in the [avni-client](https://github.com/avniproject/avni-client) repository.

## Steps:

1. [Create new flavor in android-client](https://avni.readme.io/docs/flavouring-avni#steps-to-create-a-new-flavor-in-client)
2. [Configure to get build from circle-ci](https://avni.readme.io/docs/flavouring-avni#steps-to-do-in-to-get-build-via-circle-ci)
3. [Steps to follow in google playstore](https://avni.readme.io/docs/flavouring-avni#steps-to-do-in-google-play-store)

### Steps to create a new flavor in client:

* Under `packages/openchs-android/android/app/src`, create a folder with the flavor name.
  * Flavor naming conventions:
    * Use camelCase for flavor name, since it is used in the android [docs](https://developer.android.com/build/build-variants).  This is also inline with the folder names generated during the build process.
    * The flavor name, need not have org name, just app name will suffice. 
    * Eg: for `Teach Nagaland` app from LFE, the flavor name can be `teachNagaland` and not `teach_nagaland` or `lfeTeachNagaland`.
  * Under `assets` folder add `logo.png`. The file needs to be in `png` format for the animation in the screensaver to work and for the logo to appear in the Login page.
    * To resize the logo to a reasonable size, `Preview` app can be used. Open the file and go to `Tools -> Adjust Size`.
    * To convert the logo from say, jpg to png format, open the file, then go to `File -> Export -> Change the format to png -> Save`.
  * Under `res` folder, create folders for each resolution. This images in this folder is used to display launcher icon in android app. This [website](https://icon.kitchen/) can be used to generate circle and square icons for each resolution.
  * To integrate with firebase analytics, copy `google-services.json` from [firebase console](https://console.firebase.google.com/u/0/) by creating a project specific to the flavor or an app within an existing project as per need. To view data of an app within a project, you can : Add comparison > Dimension = "Stream name" > Match Type = "exactly matches" > Value: select your app via checkbox
  * When some resources are common across flavors, add it under `packages/openchs-android/android/app/src/main` folder (instruction for Avni product team only)
  * Add a flavor specific privacy policy under `docs` to be linked to from the play store app listing using the Avni privacy policy as a reference and make changes specific to the flavor such as app name.
* Changes to be made in `build.gradle`
  * Add the `signingConfig` for the new flavor. To create keystore, check [here](https://developer.android.com/studio/publish/app-signing#generate-key) or use the following command.
    * `keytool -genkey -v -keystore <flavor>-release-key.keystore -storepass <keystorepassword> -alias <alias> -keypass <keypassword> -keyalg RSA -keysize 2048 -validity 10000`
  * In `packages/openchs-android/android/app/build.gradle`, under `productFlavors` add the key value pairs for the new flavor. 
    * For applicationId, use the format, `com.openchsclient.{client_name}.{region_name}`, where `region_name` need to be given if different flavors of the app exists for different regions.
    * create new bugsnag app, and add its API key.
  * Using `sourceSets` config in the `build.gradle`, modules specific to flavors can be configured.
* In `flavor_config.json` add the config for the new flavor. The values here are used by make tasks.
  * super admin password of the server url need to be mentioned as value for `prod_admin_password_env_var_name` .

### Steps to do to get build via circle-ci:

* Update `.circleci/config.yml` to add flavor to enum of valid `flavors`.
* Add environment variables.
  * Go to `Project Settings -> Environment variables` in circleci.
  * Add values for key password (`<flavor>_KEY_PASSWORD`), key store password (`<flavor>_KEYSTORE_PASSWORD`), key alias (`<flavor>_KEY_ALIAS`), bugsnag api key.
* Refer this [link](https://avni.readme.io/docs/release-process-for-the-cloud#circleci-build) to know how to generate apks and aab from circle-ci for specific flavor.

### Steps to do in google play store:

* Create app on google play console.
* Under `Grow -> Store Presence -> Main store listing` and enter the details. For phone and tablet screenshots, same screenshots can be uploaded.
* Under `Grow -> Store settings`, enter the details similar to other app.
* Go to `Publishing overview` and finish the steps mentioned to be able to publish for review.
  * For privacy policy, make sure the privacy policy mentions the name of the app instead of `Avni`.
  * To complete the steps take the help of already filled values of other apps. For that refer, `Policy and programmes -> App content -> Actioned` 
* Create release. 
  * As per this [link](https://stackoverflow.com/questions/73132752/i-dont-use-ads-in-my-flutter-app-then-why-this-message-is-showing-in-my-play-co), seems like Firebase Analytics plugin needs permission `com.google.android.gms.permission.AD_ID`. Hence click `Yes` for `AD_ID` permissions and check `Analytics` for usage.
  * Upload the bundle downloaded from the playstore.
* Send the changes made above for review.

### How to use a specific flavor:

By default, generic flavor without organisation branding will be picked up . When need to run make tasks for specific flavor, pass the flavor variable to the make task.

Eg: ` make run_app_staging flavor='apf'`

### Other branding changes in Avni that are relevant

There are other places where icons/colours can be configured. Below is a table that summarizes the changes that are possible. All changes can be performed through the App Designer.

| Type   | Item              | Specifications                                                                                                |
| :----- | :---------------- | :------------------------------------------------------------------------------------------------------------ |
| Icon   | Subject Type Icon | jpg/png square images 75 \* 75 px                                                                             |
| Icon   | Report card       | jpg/png square images 75 \* 75 px                                                                             |
| Icon   | Menu Item         | Material Community Icon from [https://pictogrammers.com/library/mdi/](https://pictogrammers.com/library/mdi/) |
| Colour | Program           | RGB                                                                                                           |
| Colour | Report Card       | RGB                                                                                                           |
| Colour | Form Header       | RGB                                                                                                           |

---

## `readme/Implementers/advanced-feature-guide/importing-excel-data.md`

title: Excel-based migration [Deprecated]
excerpt: ''
> ❗️ Avni does not support Excel based import any longer, please refer to Admin App based approach to upload data [Bulk Data Upload page](https://avni.readme.io/docs/upload-data#is-the-order-of-values-important)

> 🚧 Introduction
>
> Read [https://avni.readme.io/v2.0/docs/structure-import-metadata-excel-excel](https://avni.readme.io/v2.0/docs/structure-import-metadata-excel-excel)

**Note: dates get parsed incorrectly sometimes while converting from CSV to XLSX in Google Sheets (Eg. 12-01-2018 (dd-mm-yyyy) gets parsed as 01/12/2018) which may not be easy to spot. One solution is to download the CSV file and convert to XLSX in LibreOffice.**

[An example of Metadata.xlsx file](https://docs.google.com/spreadsheets/d/1M0QvcgZ7TagcHvMnTSo3qt-sZHwUDHEiN0T2hlKTn9Y/edit?usp=sharing)\
[An example of Data.xlsx file](https://docs.google.com/spreadsheets/d/19aCEIlODNvJMR68_mGl4Q-Kx6n3qI0Dk4hL0aQ8dwAo/edit?usp=sharing)

---

## `readme/Implementers/advanced-feature-guide/integration-service-operations.md`

title: Integration Service Operations
excerpt: ''
Please refer to the [Integration design and developer guide](doc:integration-developer-guide) for - how to develop integration code. This guide describes how to operate and support the integration service

### Managing Metadata Mapping

When new fields or sometimes entity types come up in the system or incorrect mapping needs to be fixed, then the one can use the Metadata Mapping tab to do so. For all entities and fields in Avni name/title is used. For other system it could be UUID or some other identifier. When providing the field mapping one should provide the parent entity type of the field.

### Integration job monitoring

* Background jobs can be monitored via [https://healthchecks.io/](https://healthchecks.io/). The failure here indicates that the background job didn't complete in time. It could be because the job didn't run, or it hung, or it failed with error. A ticket can be raised or product team support can be taken when this happens.
  * If it failed for error then the error can be checked in Bugsnag. The stack trace and link to the error can be put in the ticket. Usually these should be urgent tickets.

### Business Error monitoring

The integration module is coded to handle business errors. These are also called classified errors. The errors can be viewed from the Error tab in the admin app. The operations team should ignore these errors when the system is handed over to the customer. The customer is responsible for looking at classified errors and fixing them by fixing the data.

The classified errors are due to data in Avni or the integrated system - never in the integration service module. If this is not the case then product team should be informed.

For each classified error the required action must be available in the document as to how to rectify them.

In most integration systems, these errors are frequent - hence no specific monitoring has been put up for this. But it can be if required.

### Frequency of scheduled job

Each module has two scheduled jobs - for regular and error processing. The regular job performs synchronising in both directions (if applicable). These jobs can be run more or less frequently via the system environment variable of the integration service.

---

## `readme/Implementers/advanced-feature-guide/my-dashboard-and-search-filters.md`

title: My Dashboard and Search Filters
excerpt: ''
    - type: basic
      slug: translation-management
      title: Translation Management
---
Avni allows the display of custom filter in **Search** and **My Dashboard filter** page. These settings are available within App designer. Filter settings are stored in organisation\_config table.  You can define filters for different subject types. Please refer to the table below for various options.

# Filter Types

<Table align={["left","left","left"]}>
  <thead>
    <tr>
      <th style={{ textAlign: "left" }}>
        Type
      </th>

      <th style={{ textAlign: "left" }}>
        Applies on Field
      </th>

      <th style={{ textAlign: "left" }}>
        Widget Types
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td style={{ textAlign: "left" }}>
        Name
      </td>

      <td style={{ textAlign: "left" }}>
        Name of the subject
      </td>

      <td style={{ textAlign: "left" }}>
        Default (Text)
      </td>
    </tr>

    <tr>
      <td style={{ textAlign: "left" }}>
        Age
      </td>

      <td style={{ textAlign: "left" }}>
        Age of the subject
      </td>

      <td style={{ textAlign: "left" }}>
        Default : Numeric field. Fetches result matching records with values +/- 4.
      </td>
    </tr>

    <tr>
      <td style={{ textAlign: "left" }}>
        Gender
      </td>

      <td style={{ textAlign: "left" }}>
        Gender of the subject
      </td>

      <td style={{ textAlign: "left" }}>
        Default : Multiselect with configured gender options.
      </td>
    </tr>

    <tr>
      <td style={{ textAlign: "left" }}>
        Address
      </td>

      <td style={{ textAlign: "left" }}>
        Address of the subject
      </td>

      <td style={{ textAlign: "left" }}>
        Default : Multiselect option to choose the address of the subject. Nested options appear if multiple levels of address are present. e.g. District -> Taluka -> Village.
      </td>
    </tr>

    <tr>
      <td style={{ textAlign: "left" }}>
        Registration Date
      </td>

      <td style={{ textAlign: "left" }}>
        Date of Registration of the subject
      </td>

      <td style={{ textAlign: "left" }}>
        Default : Fixed date\
        Range : Options to choose Start date and End date
      </td>
    </tr>

    <tr>
      <td style={{ textAlign: "left" }}>
        Enrolment Date
      </td>

      <td style={{ textAlign: "left" }}>
        Date of Enrolment in any program
      </td>

      <td style={{ textAlign: "left" }}>
        Default : Fixed date\
        Range : Options to choose Start date and End date
      </td>
    </tr>

    <tr>
      <td style={{ textAlign: "left" }}>
        Encounter Date
      </td>

      <td style={{ textAlign: "left" }}>
        Date of Encounter in any Encounter
      </td>

      <td style={{ textAlign: "left" }}>
        Default : Fixed date\
        Range : Options to choose Start date and End date
      </td>
    </tr>

    <tr>
      <td style={{ textAlign: "left" }}>
        Program Encounter Date
      </td>

      <td style={{ textAlign: "left" }}>
        Date of Program Encounter in any Program Encounter
      </td>

      <td style={{ textAlign: "left" }}>
        Default : Fixed date\
        Range : Options to choose Start date and End date
      </td>
    </tr>

    <tr>
      <td style={{ textAlign: "left" }}>
        Search All
      </td>

      <td style={{ textAlign: "left" }}>
        Text fields in all the core fields and observations in Registration and Program enrolment
      </td>

      <td style={{ textAlign: "left" }}>
        Default : Text Field
      </td>
    </tr>
  </tbody>
</Table>

#### Limitation: Right now we cannot have multiple scopes for a filter, i.e. we cannot search a concept in program encounter and encounter with the same filter.

# Users need to sync the app for getting any of the above changes.

---

## `readme/Implementers/advanced-feature-guide/new-longitudinal-export.md`

title: New Longitudinal export
excerpt: Guide for New Longitudinal Export
## Introduction

The “New Longitudinal export” feature allows for an Implementation Admin user to extract data in Longitudinal format for a specific Subject Type. All invoked requests are listed at the bottom of the “New Longitudinal export” screen, which also includes Status information. The export requests are processed asynchronously in the backend and upon completion they are uploaded to cloud and are available for download in the same screen in-line with the request status details.

New longitudinal export fixes the following issues with old export.

* Inability to fetch data across different forms for the same subject. eg: Fetch data from two different encounter types on the same program
* Inability to fetch group/household information
* Inability to fetch only selected fields from different forms

### Limitations

* There is a limit of maximum of 10,000 Individuals data that could be exported at once, as part of a single Longitudinal export request

## Presupposition

In-order for an Implementation admin user to be able to successfully invoke a “New Longitudinal export” request, he / she would need to have the following:

* Basic understanding of JSON syntax
* Understanding of Avni Entity Types and their inter-relationships

## Preparation

Implementation Admin would need to come up with a list of UUIDs corresponding to Entity Types and Concepts whose data should be included in the exported file.

In-order to fetch this, the most accessible approach is the Avni Webapp. The concept uuid is shown in the address bar, where-as the Entity type (Individual) UUIDs are available on inspecting the network response, as shown in the screenshot below.

![Reference Screen-shot for fetching UUID for Subject type](https://files.readme.io/487a1fa-Screenshot_2023-05-30_at_6.43.42_PM.png)

For Avni Internal team members, they can connect to the DB and invoke appropriate SQL queries to fetcht the UUID information.

```Text SQL
#Query to fetch concept names and UUIDs
set role <org_db_user>;
select
    f.name  as FormName
    -- ,fm.entity_id
    -- ,fm.observations_type_entity_id
    -- ,fm.organisation_id
        ,
    feg.name,
    fe.name as "Form Element",
    c2.name as "Concept"
from form f
         inner join form_element_group feg on feg.form_id = f.id
         inner join form_element fe on fe.form_element_group_id = feg.id
         inner join concept c2 on fe.concept_id = c2.id
order by
    f.name
       , feg.display_order asc
       , fe.display_order asc;
```

## Request Payload Format

```sql JSON
{
  "individual": {
    "uuid": "<Specify Subject Type's UUID>",
    "fields": [
      "id",
      "uuid",
      "firstName",
      "registrationDate",
      "gender",
      "dateOfBirth"
    ],
    "filters": {
      "addressLevelIds": [],
      "date": {
        "from": "2020-01-12",
        "to": "2022-05-04"
      }
    },
    "encounters": [
      {
        "uuid": "<Specify Encounter type's UUID>",
        "fields": [
          "id",
          "encounterDateTime",
          "cancelDateTime",
          "uuid",
          "name",
          "voided",
          "<Specify Encounter's Concept UUID>"
        ],
        "filters": {
          "includeVoided": true,
          "date": {
            "from": "2020-01-12",
            "to": "2022-05-04"
          }
        }
      }
    ],
    "groups": [
      {
        "uuid": "<Specify Group Subject Type's UUID>",
        "fields": [
          "id",
          "uuid",
          "firstName"
        ],
        "encounters": [
          {
            "uuid": "<Specify Group Subject's Encounter Type UUID>",
            "fields": [
              "id"
            ]
          }
        ]
      }
    ],
    "programs": [
      {
        "uuid": "<Specify Program's UUID>",
        "fields": [
          "id",
          "uuid",
          "enrolmentDateTime"
        ],
        "encounters": [
          {
            "uuid": "<Specify Program Encounter's UUID>",
            "fields": [
              "id",
              "uuid",
              "name",
              "encounterDateTime",
              "cancelDateTime",
              "voided",
              "<Specify Program Encounter's Concept 1 UUID>",
              "<Specify Program Encounter's Concept 2 UUID>"
            ],
            "filters": {
              "includeVoided": true
            }
          }
        ]
      }
    ]
  },
  "timezone": "Asia/Calcutta"
}

```

## Description of elements that can be used to compose a Export request

```c <ROOT> (The root JSON element)
- "individual" : "<Specify Subject Type request details>"
- "timezone" : "<Specify timezone to adhere while displaying date fields>"
```

```c "individual” (Request details of the Subject Type for which data has to be extracted)
- "uuid" : "<Specify Subject Type's UUID>"
- "fields" : "<Specify fields on subjects to be included in the export>"
- "filters" : "<Specify filters applicable on subjects to be included in the export>"
- "encounters" : "<Specify General Encounter Types request details>"
  -- "uuid" : "<Specify Encounter Type's UUID>"
  -- "fields" : "<Specify fields on Encounters to be included in the export>"
  -- "filters" : "<Specify filters applicable on Encounters to be included in the export>"
  -- "maxCount" : "<Specify maximum count of Encounters to be included in the export>"
- "groups" : "<Specify Group Subject request details>"
  -- "uuid" : "<Specify Group Subject’s UUID>"
  -- "fields" : "<Specify fields on Group Subject’s to be included in the export>"
  -- "filters" : "<Specify filters applicable on Group Subject to be included in the export>"
  -- "maxCount" : "<Specify maximum count of Group to be included in the export>"
  -- "encounters" : "<Specify Group Subject Encounter Type’s request details>"
- "programs" : "<Specify Program request details>"
  -- "uuid" : "<Specify Program's UUID>"
  -- "fields" : "<Specify fields on Program Enrolment’s to be included in the export>"
  -- "filters" : "<Specify filters applicable on Program Enrolments to be included in the export>"
  -- "maxCount" : "<Specify maximum count of Program Enrolment to be included in the export>"
  -- "encounters" : "<Specify Program Encounter Types request details>"
```

### Allowed list of Individual fields that could be included in the export file ("fields" within “individual” or "groups" element )​

```c Fields
"id"  
"uuid"  
"firstName"  
"middleName"  
"lastName"
"dateOfBirth"  
"registrationDate"  
"gender"  
"createdBy"  
"createdDateTime"  
"lastModifiedBy"  
"lastModifiedDateTime"  
"voided"  
"registrationDate"  
"registrationLocation"
"gender"  
"dateOfBirth"  
"concept_uuid" : "<Specify Individual’s Concept UUID>"
```

### Allowed list of filters that could be applied to an entity ( "filters" within any entity “individual”, “encounters”, “groups”, “programs”)

```c Filters
"addressLevelIds" : "<Specify Array of Address Level Ids>"  
"date" : "<Specify date range to filter data>"  
"includeVoided" : "<Specify whether voided fields should be included, Allowed values are a. true and b.false >"
```

### Allowed fields with-in "date" element nested inside other entities(Used to restrict the data fetch to have registrationDate or encounterDateTime within the range specified)

```c Date
"from" : Format => "yyyy-MM-dd" Ex: "2020-01-12" (Mandatory)  
"to" : Format => "yyyy-MM-dd" Ex: "2020-01-12" (Mandatory)
```

### Allowed list of Encounter fields that could be included in the export file  ("fields" within "encounters", "program encounters" and  "group subject encounters" element)

```c Fields
"id"  
"uuid"  
"name"  
"earliestVisitDateTime"  
"maxVisitDateTime" 
"encounterDateTime"  
"encounterLocation"
"cancelLocation"
"cancelDateTime"
"createdBy"  
"createdDateTime"  
"lastModifiedBy"  
"lastModifiedDateTime"  
"Voided"
"concept_uuid" : "<Specify Encounter’s Concept UUID>"
```

### Allowed list of enrolment fields that could be included in the export file ("fields" within "enrolment" element )

```c Fields
"id"  
"uuid"  
"name"  
"enrolmentDateTime"  
"programExitDateTime"
"enrolmentLocation"
"exitLocation"
"createdBy"  
"createdDateTime"  
"lastModifiedBy"  
"lastModifiedDateTime"  
"Voided"
"concept_uuid" : "<Specify Enrolment’s Concept UUID>"
```

## Sample Payload

```c JSON
{
   "individual": {
       "uuid": "d22027ff-e019-4d1c-9352-bd740efccc38",
       "fields": ["id", "uuid", "firstName", "registrationDate", "gender", "dateOfBirth"],
       "filters": {
           "addressLevelIds": [],
           "date": {
               "from": "2020-01-12",
               "to": "2022-05-04"
           }
       },
       "encounters": [
           {
               "uuid": "16a3be1b-18a1-45e9-bfc8-f7915898abef",
               "fields": ["id", "encounterDateTime", "cancelDateTime", "uuid", "name", "voided",
                               "1f51e7f7-6db0-41ea-a372-e7b553ccb857",
                               "a6a6d4c0-4339-4ef0-b152-6d1c23eaf7c2",
                               "a44678fd-ee6d-4dc5-b103-f5534eb0f338",
                               "ab095140-b090-4f59-98ac-89b6479df471"],
               "filters": {
                           "includeVoided": true,
                           "date": {
                               "from": "2020-01-12",
                               "to": "2022-05-04"
                           }
                       }
           }
       ],
       "groups": [
           {
               "uuid": "e524b328-c0ad-4232-9fcb-2cf8c126a2c6",
               "fields": ["id", "uuid", "firstName"],
               "encounters": [
                   {
                       "uuid": "0c823f64-b2ec-420b-9e28-5e953b66b6d1",
                       "fields": ["id"]
                   }
               ]
           }
       ],
       "programs": [
           {
               "uuid": "9d6cd285-fb85-48f0-badc-6f004b9024d8",
               "fields": ["id", "uuid", "enrolmentDateTime"],
               "encounters": [
                   {
                       "uuid": "b2f419dc-209a-4285-b74c-29d93f2a628e",
                       "fields": ["id", "uuid", "name","encounterDateTime", "cancelDateTime","voided",
                           "45f02196-217b-4772-8085-3d17c41244da",
                           "d1774f83-ee28-41b8-9cb8-309098ee0f16",
                           "82efa85a-46a9-4c75-8c53-c488b8c48c54",
                           "84a99b8c-f9bb-4436-9d83-d79a60a0b450",
                           "74745370-ee9e-4f58-b25e-57ebac69d75d",
                           "2da75202-7f70-4a76-a8eb-cd9b289cdf8a",
                           "d9f8ee0c-960f-43d7-9b02-aa2557a9aa10",
                           "3e092c91-8e32-42b1-ac26-045b846e3893",
                           "80d88c23-1e44-423a-96bf-5ddaf105042e",
                           "e9190320-3211-4d9f-a72c-288f42cf830c",
                           "1cae9bd0-0dba-4479-954a-2d569c58d711",
                           "ac4d5664-0b5f-467f-a3c9-c0e4c8c221b7",
                           "8f67d53a-07bf-4652-b7ad-f2f6ef6bdfa2",
                           "44a608f8-54d3-4a8b-96b8-7175c65e1d01",
                           "a9f45a38-99a7-4fd8-8e28-1291434eace0",
                           "dfdc75c1-5a47-4aae-887c-3ee9f050d75e",
                           "c78e883a-60de-4629-8d85-8e4512cd13d5",
                           "0fc3b733-0ee0-4554-b316-e5e29c1978d2",
                           "83f01615-04b1-4115-84a5-48e89c9aff54",
                           "5e4d8a9d-28a5-49ec-a4c9-cd9cfd4dd134",
                           "89bf3601-d8ab-4353-85a3-8070a959394e",
                           "8263f129-5851-4f9d-a909-818dacacd862",
                           "5592def2-fe5e-4234-9253-ca5fd0322e26"],
                       "filters": {
                           "includeVoided": true
                       }
                   }
               ]
           }
       ]
   },
   "timezone": "Asia/Calcutta"
}

```

---

## `readme/Implementers/advanced-feature-guide/news-broadcast.md`

title: News broadcast
excerpt: ''
Sometimes it is important to share some important information with all the field users. Avni provides this facility using the News broadcast feature. This feature helps in easy communication with the field users.

## Creating a news broadcast

Creating a news broadcast is very simple, follow the below steps.

* Go to the home page of the Avni web app and open the News Broadcast app.

<Image title="News Broadcast.png" alt={1839} align="center" src="https://files.readme.io/2623e59-News_Broadcast.png">
  Click on the news broadcast to see all the news set up in the organisation
</Image>

* Click on "Create a news broadcast".

<Image title="Create News.png" alt={1846} align="center" src="https://files.readme.io/e42cb0c-Create_News.png">
  The new broadcast can be created by clicking on Create a new broadcast
</Image>

* Provide all the details like image, title, and content and click on "Save news".

<Image title="new news.png" alt={1854} align="center" src="https://files.readme.io/e79d8b2-new_news.png">
  New broadcast screen
</Image>

* Once the news is saved, we need to publish it so that field users can see it on their device. For publishing the news click on "see details" and click on "Publish news".
* Once the news is published field user can see it on their android app.

## News option on android app

After the news is published, the field user can go to "More -> News" to see all the published news. News details can be read by pressing any of the news card.

---

## `readme/Implementers/advanced-feature-guide/offline-reports.md`

title: Offline Report Cards and Custom Dashboards
excerpt: ''
Avni allows you to create different indicator reports that are available offline to the field users. These reports help field users to derive more insights on the captured data. 

Creating an offline report is a two-step process. First, we need to create a report card that holds the actual query function. Second, we group multiple cards into to a dashboard.

## Creating a Report Card

Creating a new report card is no different than creating any other Avni entity. Open app designer and go to the report card tab. Click on the new report card and provide the details like name description, etc.

### Report Card Types

Report cards can be of 2 types - 'Standard' and 'Custom'. The logic used to display the values in 'Standard' type cards are already implemented in Avni whereas the logic needs to be written by the implementer for 'Custom' type cards.

1. Standard Report Cards, the different types of which are as follows (Entity specified in brackets indicates the type of entity listed on clicking on the card):

   * Pending approval (Entity Approval Statuses)

   * Approved (Entity Approval Statuses)

   * Rejected (Entity Approval Statuses)

   * Scheduled visits (Subjects)

   * Overdue visits (Subjects)

   * Recent registrations (Subjects)

   * Recent enrolments (Subjects)

   * Recent visits (Subjects)

   * Total (Subjects)

   * Comments (Subjects)

   * Call tasks (Tasks)

   * Open subject tasks (Tasks)

   * Due checklist (Individuals)

   <Image align="center" src="https://files.readme.io/5093034-Screenshot_2023-12-11_at_4.55.48_PM.png" />
2. Custom Report cards: Report card with configurable **Query**, which returns a list of Individuals as the response. Length of the list is shown on the card and on clicking the card, the list of Individuals returned is shown. Please note that the query function can return a list of Individuals or an object with these properties, ` { primaryValue: '20', secondaryValue: '(5%)',  lineListFunction  }`, here `lineListFunction` should always return the list of subjects.

![](https://files.readme.io/387d221-Report_card.png "Report card.png")

#### Standard Report Card Type Filters

Filters can be added at the report card level for certain standard report types. The following filters are supported:

1. Subject Type
2. Program
3. Encounter Type
4. Recent Duration

Subject Type, Program and Encounter Type filters are supported for 'Overdue Visits', 'Scheduled Visits', 'Total' and 'Recent' types ('Recent registrations', 'Recent enrolments', 'Recent visits').

![](https://files.readme.io/c2f3eb0a468c1e8e3efb808ccb831cf87e19c5da5ba92ae9ed99a0af619d528f-image.png) 

<br />

Filters can also be configured at the dashboard level (covered below). If a filter is configured both at the report card level and the dashboard level, the filter at the report card level is applied first. Hence, mixing of the same type of filter at both levels should be avoided as it could lead to the unintuitive behaviour of the field user selecting a value, say 'Household' for the subject type filter at the dashboard level but still seeing the numbers for the 'Individual' subject type which is configured at the report card level.

## Creating a Dashboard

After all the cards are done it's time to group them together using the dashboard. Offline Dashboards have the following sub-components:

* Sections : Visual Partitions used to club together cards of specific grouping type
* Offline (Custom) Report Cards : Usually Clickable blocks with count information about grouping of Individuals or EntityApprovals of specific type
* Filters : Configurable filters that get applied to all "Report Cards" count and listing

Users with access to the "App Designer" can Create, Modifiy or Delete Custom Dashboards as seen below. 

![](https://files.readme.io/824878a-image.png)

### Steps to configure a Custom Dashboard

* Click on the dashboard tab on the app designer and click on the new dashboard.
* This will take you to the new dashboard screen. Provide the name and description of the dashboard.
* You can create sections on this screen and
* Select all the cards you need to add to the section in the dashboard.
* After adding all the cards, you can re-arrange the cards in the order you want them to see in the field app.

<Image align="center" src="https://files.readme.io/b6a8b74-Screenshot_2023-12-11_at_4.45.34_PM.png" />

### Dashboard Filters

You can also create filters for a dashboard on the same screen by clicking on "Add Filter". This shows a popup as in the below screenshot where you can configure your filter and set the filter name, type, widget type and other values based on your filter type.

![](https://files.readme.io/91f1aa1-image.png)

Once all the changes are done. Save the dashboard.

#### For the filters to be applied to the cards in the dashboard, the code for the cards will need to handle the filters.

Sample Code for handling filters in report card:

```
'use strict';
({params, imports}) => {
//console.log('------>',params.ruleInput.filter( type => type.Name === "Gender" ));
//console.log("params:::", JSON.stringify(params.ruleInput));
  let individualList = params.db.objects('Individual').filtered("voided = false and subjectType.name = 'Individual'" )
     .filter( (individual) => individual.getAgeInYears() >= 18 && individual.getAgeInYears() <= 49  &&  individual.getObservationReadableValue('Is sterilisation done') === 'No');
  
  if (params.ruleInput) {

       let genderFilter = params.ruleInput.filter(rule => rule.type === "Gender");
       let genderValue = genderFilter[0].filterValue[0].name;
      
        console.log('genderFilter---------',genderFilter);
        console.log('genderValue---------',genderValue);        
        
      return individualList
     .filter( (individual) => {
     console.log("individual.gender:::", JSON.stringify(individual.gender.name));
     return individual.gender.name === genderValue;
     });
     }
     else return individualList;
};
```

### Assigning custom Dashboards to User Groups

Custom Dashboards created need to be assigned specifically to a User Group, in-order for Users to see it on the Avni-client mobile app. You may do this, by navigating to the "Admin" app -> "User Groups" -> (User\_GROUP) -> "Dashboards" tab, and assigning one or more Custom Dashboards to a User-Group.

In addition, You can also mark one of these Custom Dashboards as the Primary (Is Primary: True) dashboard from the "Admin" app -> "User Groups" -> (User\_GROUP) -> "Dashboards".

<Image align="center" src="https://files.readme.io/54b6434-Screenshot_2024-06-26_at_12.14.37_PM.png" />

## Using the Dashboard in the Field App

After saving the dashboard sync the field app, and from the bottom "More" tab click on the "Dashboards" option. It will take you to the dashboard screen and will show all the cards that are added to the dashboard.

<Image title="dashboard-field-app.png" alt="Report cards only passing List of subjects." align="center" width="400px" src="https://files.readme.io/8b37cf6-Screenshot_2024-06-26_at_12.15.37_PM.png">
  Report cards only passing List of subjects.
</Image>

<Image title="offline-dashboard.png" alt={566} align="center" width="400px" src="https://files.readme.io/548f99d-offline-dashboard.png">
  Report cards  returning `primaryValue` and `secondaryValue` object
</Image>

Clicking any card will take the user to the subject listing page, which will display all the subject names returned by the card query.

<Image align="center" width="400px" src="https://files.readme.io/18fb944-Subject-list-field-app.png" />

Users can click on any subject and navigate to their dashboard.

## Secondary Dashboard

### Web app configuration

As part of Avni release 8.0.0, a new feature of a secondary dashboard is added which can be configured at user group level to populate an additional option on the Avni mobile app bottom drawer to navigate to a secondary dashboard. This configuration has to be done in the user group in Avni web app. 

* By navigating to the dashboard section in a particular user group where dashboards can be added to user groups, the secondary dashboard can be defined apart from the home dashboard. As shown in the screenshot below, any dashboard can be selected as the secondary dashboard.

<Image align="center" width="1500px" src="https://files.readme.io/68ac5d9-Screenshot_2024-06-26_at_12.14.37_PM.png" />

<Image align="center" width="15px" src="https://files.readme.io/a5640e1-Se.png" />

### Secondary dashboard in mobile app

The configuration mentioned above would display the particular dashboard in the mobile app as given below. This would allow users to access the home and secondary dashboard from the bottom drawer of the mobile app instead of navigating to the more page. 

<Image align="center" width="400px" src="https://files.readme.io/d95166d-Screenshot_2024-06-26_at_12.17.40_PM.png" />

### Clash in Dashboards configuration across different UserGroups

In-case a User belongs to multiple UserGroups, where-in each has a different Primary and/or Secondary Dashboards, then the behaviour is undeterministic. I.e, any of the possible Primary Dashboards across the various UserGroups, would show up as the Primary on the app. Similar behaviour should be expected of the Secondary Dashboard as well.

## Report card query example

As mentioned earlier query can return a list of Individuals or an object with properties, ` { primaryValue: '20', secondaryValue: '(5%)',  lineListFunction  }`. DB instance is passed using the params and useful libraries like lodash and moment are available in the imports parameter of the function. Below are some examples of writing the `lineListFunction`.

The below function returns a list of pregnant women having any high-risk conditions.

```javascript High risk condition women
'use strict';
({params, imports}) => {
    const isHighRiskWomen = (enrolment) => {
        const weight = enrolment.findLatestObservationInEntireEnrolment('Weight');
        const hb = enrolment.findLatestObservationInEntireEnrolment('Hb');
        const numberOfLiveChildren = enrolment.findLatestObservationInEntireEnrolment('Number of live children');
        return (weight && weight.getReadableValue() < 40) || (hb && hb.getReadableValue() < 8) ||
            (numberOfLiveChildren && numberOfLiveChildren.getReadableValue() > 3)
    };
    return {
      lineListFunction: () => params.db.objects('Individual')
        .filtered(`SUBQUERY(enrolments, $enrolment, SUBQUERY($enrolment.encounters, $encounter, $encounter.encounterType.name = 'Monthly monitoring of pregnant woman' and $encounter.voided = false).@count > 0 and $enrolment.voided = false and voided = false).@count > 0`)
        .filter((individual) => individual.voided === false && _.some(individual.enrolments, (enrolment) => enrolment.program.name === 'Pregnant Woman' && isHighRiskWomen(enrolment)))
    }
};
```

It is important to write optimised query and load very less data in memory for processing. There will be the cases where query can't be written in realm and we need to load the data in memory, but remember more data we load into the memory slower will be the reports. As an example consider below two cases, in the first case we directly query realm to fetch all the individuals enrolled in Child program, but in the second case we first load all individuals into memory and then filter those cases. 

```javascript Query in Realm context (better performance)
'use strict';
({params, imports}) => ({
    lineListFunction: () => params.db.objects('Individual')
        .filtered(`SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and voided = false).@count > 0`)
});
```
```javascript Query in app context (poor performance)
'use strict';
({params, imports}) => {
    return params.db.objects('Individual')
        .filter((individual) => individual.voided === false && _.some(individual.enrolments, (enrolment) => enrolment.program.name === 'Child'))
};
```

For using the filters in the rules also check section on Dashboard Card Rule here - [Writing rules](doc:writing-rules)

## Performance of queries

The report cards requires one to return a list individuals. This can be done by:

1. Performing db.objects on Individual and filtering them down.
2. Performing db.objects on descendants of Subject (like encounter, enrolment), filter them down, then return list of Individuals from each filtered object. Example is given below.

## Implementation Patterns for writing performant queries

Please refer to [this reference for Realm Query Language](https://www.mongodb.com/docs/atlas/device-sdks/realm-query-language/).

To understand difference between filter and filtered that is referred below, please see, [https://avni.readme.io/docs/writing-rules#difference-between-filter-and-filtered](https://avni.readme.io/docs/writing-rules#difference-between-filter-and-filtered)

Please also get in touch with platform team if you identify a new pattern and a new type of requirement where none of the following fits.

1. Filter based on chronological data
   1. The matching has to be done on specific chronological descendant entity. e.g. `first` encounter of a specific type, `recent` encounter of specific type.
   2. In this case performing `db.objects` on Individual will lead to either very complex queries or will demand performing filtering in memory using JS.
   3. In this case one can do `db.objects` on descendant entity and then use something like `.filtered('TRUEPREDICATE sort(programEnrolment.individual.uuid asc , encounterDateTime desc) Distinct(programEnrolment.individual.uuid)')` to get the chronological relevant entity at the top in each group. Distinct keyword picks only the first entity in the sorted group.
   4. After performing `filtered`, one can return Subjects by performing `list.map(enc => enc.programEnrolment.individual)`
2. Filter based exact observation value
   1. Matching observations by loading them in memory and calling JS functions will lead to slower reports.
   2. A combination of `subquery` and realm query based match will have much better performance. For example: matching observation that has a specific value - `SUBQUERY(observations, $observation, $observation.concept.name = 'Phone number' and $observation.valueJSON CONTAINS '7555795537'`
3. Filter based on exact specific coded observation value
   1. Matching coded value using its name will require one to load data in memory and perform the match. But this could result in sub-optimal performance. Hence the readability of the report should be sacrificed here for performance.
   2. The query will be like `SUBQUERY(observations, $observation, $observation.concept.uuid = 'Marital Status' and $observation.valueJSON CONTAINS 'fb1080b4-d1ec-4c87-a10d-3838ba9abc5b'`
   3. Please note here that multiple observations can be matched here using OR, AND etc.
4. Filter based on a custom observation value expression.
   1. Instead of matching against a single value match using numeric expression. e.g. match BMI greater than 20.0.
   2. This kind of match cannot be done using realm query and implementing them in JS may result in poor performance.
   3. In such cases we should find out the significance of magic number 20.0. Usually we also have a coded decision observation associated that has meaning behind 20.0, like malnutrition status, BMI Status etc. If there is one then we should match against that using pattern 3 above. If such observation is not present then consider adding them to decisions.
   4. In requirements where such associated coded observation are not present and cannot be added, the performance will depend on the number of observations and entities being matched. If this number is large the performance is expected to be slow, it is better to avoid making reports, or move such reports to their own dashboard - so that they don't impact the usability of other reports.

### Detailed examples

#### DEPRECATED: Avoid using generic functions:

* The following is deprecated cause we should use `Filter based on chronological data` pattern from above.
* To find observation of a concept avoid using the function `findLatestObservationInEntireEnrolment` unless absolutely necessary since it searches for the observation in all encounters and enrolment observations. Use specific functions.
* Eg: To find observation in enrolment can use the function `enrolment.findObservation` or to find observations in specific encounter type can get the encounters using `enrolment.lastFulfilledEncounter(...encounterTypeNames)` and then find observation. Refer code examples for the below 3 usecases.
* ```text Usecase 1
  Find children with birth weight less than 2. Birth weight is captured in enrolment
  ```
  ```javascript Recommended way
  'use strict';
  ({params, imports}) => {
      const isLowBirthWeight = (enrolment) => {
          const obs = enrolment.findObservation('Birth Weight');
          return obs ? obs.getReadableValue() <= 2 : false;
      };
      return params.db.objects('Individual')
          .filtered(`voided = false and SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false).@count > 0`)
          .filter((individual) => _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && _.isNil(enrolment.programExitDateTime) && !enrolment.voided && isLowBirthWeight(enrolment)))
  };
  ```
  ```javascript Not recommended way
  'use strict';
  ({params, imports}) => {
      const isLowBirthWeight = (enrolment) => {
          const obs = enrolment.findLatestObservationInEntireEnrolment('Birth Weight');
          return obs ? obs.getReadableValue() <= 2 : false;
      };
      return params.db.objects('Individual')
          .filtered(`SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false and SUBQUERY($enrolment.observations, $observation, $observation.concept.uuid = 'c82cd1c8-d0a9-4237-b791-8d64e52b6c4a').@count > 0 and voided = false).@count > 0`)
          .filter((individual) => individual.voided === false && _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && isLowBirthWeight(enrolment)))
  };
  ```
  ```Text How optimized
  do voided check first in realm instead of JS - helps in filtering ahead
  Check for concept where it is used - no need to check in all encounters and enrolment
  ```
  ```Text Usecase 2
  Find MAM status from value of Nutritional status concept captured in Child Followup encounter
  ```
  ```javascript Recommended way
  // While this example is illustrating the right JS function to use, but it may be better to filter(ed)
  // encounter schema than to start with Individual
  // i.e. someting like db.objects("ProgramEncounter").filtered("programEnrolment.individual.voided = false AND programEnrolment.voided = false AND ...")
  // then return Individuals using .map(enc => enc.programEnrolment.individual) after filtering all program encounters
  'use strict';
  ({params, imports}) => {
      const isUndernourished = (enrolment) => {
          const encounter = enrolment.lastFulfilledEncounter('Child Followup'); 
          if(_.isNil(encounter)) return false; 
         
         const obs = encounter.findObservation("Nutritional status of child");
         return (!_.isNil(obs) && _.isEqual(obs.getValueWrapper().getValue(), "MAM"));
      };
      
      return params.db.objects('Individual')
          .filtered(`voided = false and SUBQUERY(enrolments, $enrolment,$enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false and SUBQUERY($enrolment.encounters, $encounter, $encounter.encounterType.name = 'Child Followup' and $encounter.voided = false).@count > 0).@count > 0`)
          .filter((individual) => individual.getAgeInMonths() > 6 && _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && _.isNil(enrolment.programExitDateTime) && !enrolment.voided && isUndernourished(enrolment)))
  };
  ```
  ```javascript Not recommended way
  'use strict';
  ({params, imports}) => {
      const isUndernourished = (enrolment) => {
          const obs = enrolment.findLatestObservationInEntireEnrolment('Nutritional status of child');
          return obs ? _.includes(['MAM'], obs.getReadableValue()) : false;
      };
      return params.db.objects('Individual')
          .filtered(`SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false and SUBQUERY($enrolment.encounters, $encounter, $encounter.encounterType.name = 'Child Followup' and $encounter.voided = false and SUBQUERY($encounter.observations, $observation, $observation.concept.uuid = '3fb85722-fd53-43db-9e8b-d34767af9f7e').@count > 0).@count > 0 and voided = false).@count > 0`)
          .filter((individual) => individual.voided === false && individual.getAgeInMonths() > 6 && _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && isUndernourished(enrolment)))
  };
  ```
  ```Text How optimized
  Check only in specific encounter type
  ```
  ```Text Usecase 3
  Find sick children using the presence of value for concept 'Refer to the hospital for' which is not a mandatory concept
  ```
  ```javascript Recommended way
  // also see comments in Recommended way for use case 2
  'use strict';
  ({params, imports}) => {
      const isChildSick = (enrolment) => {
        const encounter = enrolment.lastFulfilledEncounter('Child Followup', 'Child PNC'); 
        if(_.isNil(encounter)) return false; 
         
        const obs = encounter.findObservation('Refer to the hospital for');
        return !_.isNil(obs);
      };
      
      return params.db.objects('Individual')
          .filtered(`voided = false and SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false).@count > 0`)
          .filter(individual => _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && _.isNil(enrolment.programExitDateTime) && !enrolment.voided && isChildSick(enrolment)))
  };
  ```
  ```javascript Not recommended way
  'use strict';
  ({params, imports}) => {
      const isChildSick = (enrolment) => {
           const obs = enrolment.findLatestObservationFromEncounters('Refer to the hospital for');    
           return obs ? obs.getReadableValue() != undefined : false;
      };
      
      return params.db.objects('Individual')
          .filtered(`SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false).@count > 0`)
          .filter((individual) => individual.voided === false && (_.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && isChildSick(enrolment))) )
  };
  ```
  ```Text How optimized
  Check only in last encounter, not all encounters since the concept is not a mandatory concept. 
  Using findLatestObservationFromEncounters will check in all encounters and mark child has sick even if the concept value had represented sick in any of the previous encounters, resulting in bug, since the concept is not a mandatory concept.
  ```

#### Based on the use case decide whether to write the logic using realm query or JS.

* Not always achieving the purpose using realm queries might be efficient/possible. 

  * **DEPRECATED** cause we should use `Filter based on chronological data` pattern from above. Eg: consider a use case where a mandatory concept is used in a program encounter. Now to check the latest value of the concept, its sufficient to check the last encounter and need not iterate all encounters. Since realm subquery doesn't support searching only in the last encounter, for such usecases, using realm queries not only becomes slow and also sometimes inappropriate depending on the usecase. So in such cases, using JS code for the logic, is more efficient. (refer the below code example)

    * ```Text Usecase
      Find dead children using concept value captured in encounter cancel or program exit form.
      ```
      ```javascript Recommended way
      'use strict';
      ({params, imports}) => { 
         const moment = imports.moment;

         const isChildDead = (enrolment) => {
            const exitObservation = enrolment.findExitObservation('29238876-fbd8-4f39-b749-edb66024e25e');
            if(!_.isNil(exitObservation) && _.isEqual(exitObservation.getValueWrapper().getValue(), "cbb0969c-c7fe-4ce4-b8a2-670c4e3c5039"))
              return true;
            
            const encounters = enrolment.getEncounters(false);
            const sortedEncounters = _.sortBy(encounters, (encounter) => {
            return _.isNil(encounter.cancelDateTime)? moment().diff(encounter.encounterDateTime) : 
            moment().diff(encounter.cancelDateTime)}); 
            const latestEncounter = _.head(sortedEncounters);
            if(_.isNil(latestEncounter)) return false; 
             
            const cancelObservation = latestEncounter.findCancelEncounterObservation('0066a0f7-c087-40f4-ae44-a3e931967767');
            if(_.isNil(cancelObservation)) return false;
            return _.isEqual(cancelObservation.getValueWrapper().getValue(), "cbb0969c-c7fe-4ce4-b8a2-670c4e3c5039")
          };

      return params.db.objects('Individual')
              .filtered(`voided = false`)
              .filter(individual => _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && isChildDead(enrolment)));
      }
      ```
      ```javascript Not recommended way
      'use strict';
      ({params, imports}) => {

      return params.db.objects('Individual')
              .filtered(`subquery(enrolments, $enrolment, $enrolment.program.name == "Child" and subquery(programExitObservations, $exitObservation, $exitObservation.concept.uuid ==  "29238876-fbd8-4f39-b749-edb66024e25e" and ( $exitObservation.valueJSON ==  '{"answer":"cbb0969c-c7fe-4ce4-b8a2-670c4e3c5039"}')  ).@count > 0 ).@count > 0 OR subquery(enrolments.encounters, $encounter, $encounter.voided == false and subquery(cancelObservations, $cancelObservation, $cancelObservation.concept.uuid ==  "0066a0f7-c087-40f4-ae44-a3e931967767" and ( $cancelObservation.valueJSON ==  '{"answer":"cbb0969c-c7fe-4ce4-b8a2-670c4e3c5039"}')  ).@count > 0 ).@count > 0`)
              .filter(ind => ind.voided == false)
      };
      ```
      ```Text How optimized
      Moving to JS since realm query iterates through all encounters which can be avoided in JS
      In this cases since the intention is to find if child is dead, hence it can be assumed to be captured in the last encounter or in program exit form based on the domain knowledge

      ```
  * Please also refer to `Filter based on a custom observation value expression` pattern above, before using this. Consider another use case, where observations of numeric concepts need to be compared. This is not possible to achieve via realm query since the solution would involve the need for JSON parsing of the stored observation. Hence JS logic is appropriate here. (refer below code example)
    * ```Text Usecase
      Find children with birth weight less than 2. Birth weight is captured in enrolment
      ```
      ```javascript Recommended way
      'use strict';
      ({params, imports}) => {
          const isLowBirthWeight = (enrolment) => {
              const obs = enrolment.findObservation('Birth Weight');
              return obs ? obs.getReadableValue() <= 2 : false;
          };
          return params.db.objects('Individual')
              .filtered(`voided = false and SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false).@count > 0`)
              .filter((individual) => _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && _.isNil(enrolment.programExitDateTime) && !enrolment.voided && isLowBirthWeight(enrolment)))
      };
      ```
      ```javascript Not recommended way
      'use strict';
      ({params, imports}) => {
          const isLowBirthWeight = (enrolment) => {
              const obs = enrolment.findLatestObservationInEntireEnrolment('Birth Weight');
              return obs ? obs.getReadableValue() <= 2 : false;
          };
          return params.db.objects('Individual')
              .filtered(`SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false and SUBQUERY($enrolment.observations, $observation, $observation.concept.uuid = 'c82cd1c8-d0a9-4237-b791-8d64e52b6c4a').@count > 0 and voided = false).@count > 0`)
              .filter((individual) => individual.voided === false && _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && isLowBirthWeight(enrolment)))
      };
      ```
      ```Text How optimized
      Moving to realm query for checking birth weight was not possible. If it were a equals comparison it can be achieved using 'CONTAINS' in realm
      ```
* But in cases where time complexity is the same for both cases, writing realm queries would be efficient to achieve the purpose. (refer below code example). Also refer to `Filter based on a custom observation value expression` pattern above.

  * ```Text Usecase
    Find 13 months children who are completely immunised
    ```
    ```javascript Recommended way
    'use strict';
    ({params, imports}) => {        
       return params.db.objects('Individual')
            .filtered(`voided = false and SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false and SUBQUERY(checklists, $checklist, SUBQUERY(items, $item, ($item.detail.concept.name = 'BCG' OR $item.detail.concept.name = 'Polio 0' OR $item.detail.concept.name = 'Polio 1' OR $item.detail.concept.name = 'Polio 2' OR $item.detail.concept.name = 'Polio 3' OR $item.detail.concept.name = 'Pentavalent 1' OR $item.detail.concept.name = 'Pentavalent 2' OR $item.detail.concept.name = 'Pentavalent 3' OR $item.detail.concept.name = 'Measles 1' OR $item.detail.concept.name = 'Measles 2' OR $item.detail.concept.name = 'FIPV 1' OR $item.detail.concept.name = 'FIPV 2' OR $item.detail.concept.name = 'Rota 1' OR $item.detail.concept.name = 'Rota 2') and $item.completionDate <> nil).@count = 14).@count > 0).@count > 0`)
            .filter(individual => individual.getAgeInMonths() >= 13)     
    };
    ```
    ```javascript Not recommended way
    'use strict';
    ({params, imports}) => {
        const isChildGettingImmunised = (enrolment) => {
            if (enrolment.hasChecklist) {
                const vaccineToCheck = ['BCG', 'Polio 0', 'Polio 1', 'Polio 2', 'Polio 3', 'Pentavalent 1', 'Pentavalent 2', 'Pentavalent 3', 'Measles 1', 'Measles 2', 'FIPV 1', 'FIPV 2', 'Rota 1', 'Rota 2'];
                const checklist = _.head(enrolment.getChecklists());
                return _.chain(checklist.items)
                    .filter(({detail}) => _.includes(vaccineToCheck, detail.concept.name))
                    .every(({completionDate}) => !_.isNil(completionDate))
                    .value();
            }
            return false;
        };

        return params.db.objects('Individual')
            .filtered(`SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false).@count > 0`)
            .filter((individual) => individual.voided === false && individual.getAgeInMonths() >= 13 && _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && isChildGettingImmunised(enrolment)))
    };
    ```
    ```Text How optimized
    Moving to realm query since no of children with age < 13 months were less
    ```
* In most cases, filtering as much as possible using realm queries (for cases like voided checks) and then doing JS filtering on top of it if needed, would be appropriate. (refer the below code example)

  * ```Text Usecase
    Find dead children using concept value captured in encounter cancel or program exit form.
    ```
    ```javascript Recommended way
    'use strict';
    ({params, imports}) => { 
       const moment = imports.moment;

       const isChildDead = (enrolment) => {
          const exitObservation = enrolment.findExitObservation('29238876-fbd8-4f39-b749-edb66024e25e');
          if(!_.isNil(exitObservation) && _.isEqual(exitObservation.getValueWrapper().getValue(), "cbb0969c-c7fe-4ce4-b8a2-670c4e3c5039"))
            return true;
          
          const encounters = enrolment.getEncounters(false);
          const sortedEncounters = _.sortBy(encounters, (encounter) => {
          return _.isNil(encounter.cancelDateTime)? moment().diff(encounter.encounterDateTime) : 
          moment().diff(encounter.cancelDateTime)}); 
          const latestEncounter = _.head(sortedEncounters);
          if(_.isNil(latestEncounter)) return false; 
           
          const cancelObservation = latestEncounter.findCancelEncounterObservation('0066a0f7-c087-40f4-ae44-a3e931967767');
          if(_.isNil(cancelObservation)) return false;
          return _.isEqual(cancelObservation.getValueWrapper().getValue(), "cbb0969c-c7fe-4ce4-b8a2-670c4e3c5039")
        };

    return params.db.objects('Individual')
            .filtered(`voided = false`)
            .filter(individual => _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && isChildDead(enrolment)));
    }
    ```
    ```javascript Not recommended way
    'use strict';
    ({params, imports}) => {

    return params.db.objects('Individual')
            .filtered(`subquery(enrolments, $enrolment, $enrolment.program.name == "Child" and subquery(programExitObservations, $exitObservation, $exitObservation.concept.uuid ==  "29238876-fbd8-4f39-b749-edb66024e25e" and ( $exitObservation.valueJSON ==  '{"answer":"cbb0969c-c7fe-4ce4-b8a2-670c4e3c5039"}')  ).@count > 0 ).@count > 0 OR subquery(enrolments.encounters, $encounter, $encounter.voided == false and subquery(cancelObservations, $cancelObservation, $cancelObservation.concept.uuid ==  "0066a0f7-c087-40f4-ae44-a3e931967767" and ( $cancelObservation.valueJSON ==  '{"answer":"cbb0969c-c7fe-4ce4-b8a2-670c4e3c5039"}')  ).@count > 0 ).@count > 0`)
            .filter(ind => ind.voided == false);
    };
    ```
    ```Text How optimized
    Moving to JS since realm query iterates through all encounters which can be avoided in JS
    In this cases since the intention is to find if child is dead it can be assumed to be captured in the last encounter or in program exit form based on the domain knowledge

    ```

Also check - [https://avni.readme.io/docs/writing-rules#using-paramsdb-object-when-writing-rules](https://avni.readme.io/docs/writing-rules#using-paramsdb-object-when-writing-rules)

#### DEPRECATED. Use Concept UUIDs instead of their names for comparison

Please check - `Filter based on a custom observation value expression` pattern above.

Though not much performance improvement, using concept uuids(for comparing with concept answers), instead of getting its readable values did provide minor improvement(in seconds) when need to iterate through thousands of rows. (refer below code example)

* ```Text Usecase
  Find children with congential abnormality based on values of certain concepts
  ```
  ```javascript Recommended way
  'use strict';
  ({params, imports}) => {
      const isChildCongenitalAnamoly = (enrolment) => {
         const _ = imports.lodash;
      
         const encounter = enrolment.lastFulfilledEncounter('Child PNC'); 
         if(_.isNil(encounter)) return false; 
         
         const obs1 = encounter.findObservation("Is the infant's mouth cleft pallet seen?");
         const condition2 = obs1 ? obs1.getValueWrapper().getValue() === '3a9fe9a1-a866-47ed-b75c-c0071ea22d97' : false;
           
         const obs2 = encounter.findObservation('Is there visible tumor on back or on head of infant?');
         const condition3 = obs2 ? obs2.getValueWrapper().getValue() === '3a9fe9a1-a866-47ed-b75c-c0071ea22d97' : false;
           
         const obs3 = encounter.findObservation("Is foam coming from infant's mouth continuously?");
         const condition4 = obs3 ? obs3.getValueWrapper().getValue() === '3a9fe9a1-a866-47ed-b75c-c0071ea22d97' : false;
                    
           return condition2 || condition3 || condition4;
      };
      
      const isChildCongenitalAnamolyReg = (individual) => {
           const obs = individual.findObservation('Has any congenital abnormality?');
           return obs ? obs.getValueWrapper().getValue() === '3a9fe9a1-a866-47ed-b75c-c0071ea22d97' : false;
      };
      
      return params.db.objects('Individual')
          .filtered(`voided = false and SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false).@count > 0`)
          .filter((individual) => (isChildCongenitalAnamolyReg(individual) || 
              _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && _.isNil(enrolment.programExitDateTime) && !enrolment.voided && isChildCongenitalAnamoly(enrolment) )) )
  };
  ```
  ```javascript Not recommended way
  'use strict';
  ({params, imports}) => {
      const isChildCongenitalAnamoly = (enrolment) => {
           
           const obs1 = enrolment.findLatestObservationInEntireEnrolment("Is the infant's mouth cleft pallet seen?");
           const condition2 = obs1 ? obs1.getReadableValue() === 'Yes' : false;
           
       const obs2 = enrolment.findLatestObservationInEntireEnrolment('Is there visible tumor on back or on head of infant?');
           const condition3 = obs2 ? obs2.getReadableValue() === 'Yes' : false;
           
           const obs3 = enrolment.findLatestObservationInEntireEnrolment("Is foam coming from infant's mouth continuously?");
           const condition4 = obs3 ? obs3.getReadableValue() === 'Yes' : false;
                    
           return condition2 || condition3 || condition4;
      };
      
      const isChildCongenitalAnamolyReg = (individual) => {
           const obs = individual.getObservationReadableValue('Has any congenital abnormality?');
           return obs ? obs === 'Yes' : false;
      };
      
      return params.db.objects('Individual')
          .filtered(`SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Child' and $enrolment.programExitDateTime = null and $enrolment.voided = false).@count > 0`)
          .filter((individual) => individual.voided === false && (isChildCongenitalAnamolyReg(individual) || 
              _.some(individual.enrolments, enrolment => enrolment.program.name === 'Child' && isChildCongenitalAnamoly(enrolment) )) )
  };
  ```
  ```Text How optimized
  Use concept uuid instead of readableValue to compare and check for value only in specific encounter type where the concept was used
  ```

## Nested Report Cards

Frequently there are cases where across report cards very similar logic is used and only a value used for comparison, changes. Eg: in one of our partner organisations, we load 'Total SAM children' and 'Total MAM children'. For rendering each takes around 20-30s. And hence the dashboard nos doesn't load until both the report card results are calculated and it makes the user to wait for a minute. If the logic is combined, we can render the results in 30s since it would need only retrieval from db and iterating once.\
The above kind of scenarios also lead to code duplication across report cards and when some requirement changes, then the change needs to be done in both.

In-order to handle such scenarios, we recommend using the Nested Report Card. This is a non-standard report card, which has the ability to show upto a maximum of **9** report cards, based on a single Query's response.

The query can return an object with "reportCards" property, which holds within it an array of objets with properties, ` { cardName: 'nested-i', cardColor: '#123456', textColor: '#654321', primaryValue: '20', secondaryValue: '(5%)',  lineListFunction: () => {/*Do something*/} }`. DB instance is passed using the params and useful libraries like lodash and moment are available in the imports parameter of the function. 

```javascript Nested Report Card Query Format
'use strict';
({params, imports}) => {
    /*
    Business logic
    */
    return {reportCards: \[
        {
            cardName: 'nested-i',
            cardColor: '#123456',
            textColor: '#654321',
            primaryValue: '20',
            secondaryValue: '(5%)',
            lineListFunction: () => {
                /*Do something*/
            }
        },
        {
            cardName: 'nested-i+1',
            cardColor: '#123456',
            textColor: '#654321',
            primaryValue: '20',
            secondaryValue: '(5%)',
            lineListFunction: () => {
                /*Do something*/
            }
        }
    ]
	}
};
```
```Text Mandatory Fields
- primaryValue
- secondaryValue
- lineListFunction
```
```Text Optional fields
- cardName
- cardColor
- textColor
```

```javascript Sample Nested Report card Query
// Documentation - https://docs.mongodb.com/realm-legacy/docs/javascript/latest/index.html#queries

'use strict';
({params, imports}) => {
const _ = imports.lodash;
const moment = imports.moment;

const substanceUseDue = (enrolment) => {
    const substanceUseEnc = enrolment.scheduledEncountersOfType('Record Substance use details');
    
    const substanceUse = substanceUseEnc
    .filter((e) => moment().isSameOrAfter(moment(e.earliestVisitDateTime)) && e.cancelDateTime === null && e.encounterDateTime === null );
    
    return substanceUse.length > 0 ? true : false;
    
    };
const indList = params.db.objects('Individual')
        .filtered(`SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Substance use' and $enrolment.programExitDateTime = null and $enrolment.voided = false and SUBQUERY($enrolment.encounters, $encounter, $encounter.encounterType.name = 'Record Substance use details' and $encounter.voided = false ).@count > 0 and voided = false).@count > 0`)
        .filter((individual) => _.some(individual.enrolments, enrolment => substanceUseDue(enrolment)
        )); 
        
const includingVoidedLength = indList.length;
const excludingVoidedLength = 6;  
const llf1 = () => { return params.db.objects('Individual')
        .filtered(`SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Substance use' and $enrolment.programExitDateTime = null and $enrolment.voided = false and SUBQUERY($enrolment.encounters, $encounter, $encounter.encounterType.name = 'Record Substance use details' and $encounter.voided = false ).@count > 0 and voided = false).@count > 0`)
        .filter((individual) => _.some(individual.enrolments, enrolment => substanceUseDue(enrolment)
        ));    
        };
           

return {reportCards: [{
      cardName: 'nested 1',
      textColor: '#bb34ff',
      primaryValue: includingVoidedLength,   
      secondaryValue: null,
      lineListFunction: llf1
  },
  {
      cardName: 'nested 2',
      cardColor: '#ff34ff',
      primaryValue: excludingVoidedLength,   
      secondaryValue: null,
      lineListFunction: () => {return params.db.objects('Individual')
        .filtered(`SUBQUERY(enrolments, $enrolment, $enrolment.program.name = 'Substance use' and $enrolment.programExitDateTime = null and $enrolment.voided = false and SUBQUERY($enrolment.encounters, $encounter, $encounter.encounterType.name = 'Record Substance use details' and $encounter.voided = false ).@count > 0 and voided = false).@count > 0`)
        .filter((individual) => individual.voided === false  && _.some(individual.enrolments, enrolment => substanceUseDue(enrolment)
        ));}
  }]}
};
```

### Screenshot of Nested Custom Dashboard Report Card Edit screen on Avni Webapp

<Image align="center" src="https://files.readme.io/ecdd996-Screenshot_2024-01-25_at_5.15.20_PM.png" />

### Screenshot of Nested Report Cards in Custom Dashboard in Avni Client

<Image align="center" width="576px" src="https://files.readme.io/dca68e5-Screenshot_2024-01-25_at_5.19.04_PM.png" />

![]()

Note: If there is a mismatch between the count of nested report cards configured and the length of reportCards property returned by the query response, then we show an appropriate error message on all Nested Report Cards corresponding to the Custom Report Card.

<Image align="center" width="576px" src="https://files.readme.io/82d8ca0-Screenshot_2024-01-25_at_5.23.56_PM.png" />

<br />

## Default Dashboard and Report Cards

Starting in release 10.0, any newly created organisation will have a default dashboard created with the following sections, standard cards and filters.

Default Dashboard (Filters: 'Subject Type' and 'As On Date')

1. Visit Details Section
   1. Scheduled Visits Card
   2. Overdue Visits Card
2. Recent Statistics Section
   1. Recent Registrations Card (Recent duration filter configured as - 1 day)
   2. Recent Enrolments Card (Recent duration filter configured as - 1 day)
   3. Recent Visits Card (Recent duration filter configured as - 1 day)
3. Registration Overview Section
   1. Total Card

This default dashboard will also be assigned as Primary dashboard on the 'Everyone' user group. 

## Reference screen-shots of Avni-Client Custom Dashboard with Approvals ReportCards and Location filter

<Image alt="Default state of Approvals Report Cards without any filter applied" align="center" border={true} src="https://files.readme.io/e35888a-Screenshot_2023-12-12_at_12.46.46_PM.png">
  Default state of Approvals Report Cards without any filter applied
</Image>

***

<Image alt="Custom Dashboards filter page" align="center" border={true} src="https://files.readme.io/576efec-Screenshot_2023-12-12_at_12.47.01_PM.png">
  Custom Dashboards filter page
</Image>

***

<Image alt="State of Approvals Report Cards after the Location filter was applied" align="center" border={true} src="https://files.readme.io/c5ac6f6-Screenshot_2023-12-12_at_12.47.25_PM.png">
  State of Approvals Report Cards after the Location filter was applied
</Image>

***

---

## `readme/Implementers/advanced-feature-guide/organisation-group.md`

title: How and when to use organisation group
excerpt: ''
If an organisation works with other sub-organisations performing same activity and if it wants each sub-organisation to be able to view/manage only their data - then one can check organisation group feature to solve for:

* Same app definition shared across partner organisations
* Each partner organisation get their own dashboard and reports without being able to see data from other partner organisations.
* Super organisation to be able to have a dashboard where they can view all sub-organisation data.

> 🚧 Should not be used when the number of partner organisations can grow a large number over time.

### Organisation and organisation groups

1. Mainline Organisation - for maintaining the trunk of source bundle
2. Release Organisation - for maintaining the released branch of source bundle
3. One production organisation for each partner organisation. One production organisation group.
4. Two UAT organisations. One organisation group consisting of these two organisations)
   1. Two organisations allow us to replicate the organisation group.

### Testing Deployment

Active development take places on mainline organisation.

### Release Deployment

1. The bundle from mainline organisation is released to release organisation and sanity testing can be done on this.
2. The bundle from release organisation is uploaded to each production organisation.

### Managing locations

There are two options.

1. There is one location set that is used by all partner organisations. These locations are to be imported in each organisation.
2. Each organisation has their own locations. In this case if the same logical location is used by multiple organisations, then Location should suffixed like Location1 (Org 1), Location2 (Org 1) when uploading. See the filters section below for the trade-off.

### Reporting

Metabase is not right tool for such setup and SuperSet should be used.

#### How to create separation between different partner organisations so that they do not see each other's data.

1. All reports should connect using the organisation group db\_user to the database. ETL should be enabled for only organisation group.
2. Setup row level security and roles for each organisation (feature of Superset).
3. Assign correct role to the user when provisioning users from any partner organisation
4. For users who can see the reports for all organisations no role level security role is required.

### Filters

1. Filters like dates and hardcoded values there is nothing different to be done.

2. (Assumes row-level security works for filter queries as well) Filters that display drop downs like any concept's coded values, location types query with distinct clause should be used. Distinct clause is required for super organisation users, other wise they will see repeated values from each organisation.
   1. In query match against the concept, location type name and not ID or UUID.

3. (Assumes row-level security works for filter queries as well) Filters displaying location
   1. If approach 2 has been taken the users will be required to select all locations for same logical location.

## Access control

1. App Designer, Location Types - Recommended that these edit access is not provided for these to the customer.
2. Location - In Approach 1 (in Managing Locations), the access should not be given to the customer. In approach 2 one can do that with some training on naming if required.
3. User Groups - If access has to be given to customers then the tradeoff is in giving up on centralised source bundle management and it should excluded from bundles every time.

## Activities to consider when creating multiple organisations

1. Setup of organisations as described above
2. Release is more complex than for regular organisation
3. Each partner addition will require release activities like org setup, bundle upload, location setup and administrator training, row-level security / roles creation in superset, higher support required due to lack of access control that can be provided to the customers.

---

## `readme/Implementers/advanced-feature-guide/program.md`

title: Enrol to same program multiple times
excerpt: ''
Each subject type can have multiple programs within them. If these programs are defined, the user can enroll subjects of these subject types into these programs.

Number of enrolments per subject

* Typically and hence by default, a subject can have only one active enrolment for a program. This implies that for a subject to be enrolled again the previous enrolment must be exited. e.g. Pregnancy program. Sometimes for chronic diseases, a person may remain in a program forever like diabetes. In such cases, the subject is never exited.
* Starting release 3.37, Avni also supports multiple active enrolments in a program. This can be done by switching on this per program. When this is switched on the above condition is relaxed by Avni.

<Image align="center" className="border" width="300px" border={true} src="https://files.readme.io/62b1f10-image.png" />

---

## `readme/Implementers/advanced-feature-guide/quick-form-edit-and-jump-to-summary.md`

title: Quick form edit and jump to summary
excerpt: ''
This feature allows users to jump directly to any page in the form and then quickly save the form skipping the middle questions. This will save a lot of time as now users don't have to go through all the pages.\
There is no configuration required for the quick form edit feature however, one need to enable jump to summary feature

## Enabling jump to summary

In the admin app go to "Organisation Details" and enable the "Show summary button" option. 

<Image title="Jump to summary.png" alt={1832} src="https://files.readme.io/19f3021-Jump_to_summary.png">
  Enabling Jump to summary feature
</Image>

After enabling the "jump to summary feature", sync the field app. The user will see the Summary button at the top right corner in the form.

<Image title="quick-form-edit(1).gif" alt={176} src="https://files.readme.io/aea853d-quick-form-edit1.gif">
  Quick form edit in action
</Image>

**Note**: This feature is only supported in the mobile application.

---

## `readme/Implementers/advanced-feature-guide/repeatable-question-group.md`

title: Repeatable question group
excerpt: ''
A repeatable question group is an extension of the question group form element. A Question group is like any other data type in Avni. The only difference is it allows implementers to group similar fields together and show those questions like a group. Now there are cases where you want to repeat the same set of questions(group) multiple times. This can be easily done by just marking the question group as repeatable.

## Steps to configure repeatable Question group

1. Create a form element having a question group concept.
2. This will allow you to add multiple questions inside the question group.
3. Once all the questions are added, mark it repeatable and finally save the form.

<Image title="Repeaable-question-group.png" alt={1495} align="center" src="https://files.readme.io/ae26aab-Repeaable-question-group.png">
  Notice how the question group is marked repeatable.
</Image>

<Image title="repeatable-question.gif" alt={585} align="center" src="https://files.readme.io/61bee14-repeatable-question.gif">
  Repeatable questions in mobile app
</Image>

### Limitations

At this time, the following elements that are part of the forms are not yet supported. 

* Nested Groups
* Encounter form element
* Id form element
* Subject form element with the "Show all members" option (Regular subject form elements are supported)

  * To get this working within a Question-Group/ Repeatable-Question-Group, for a Non "Group" Subject Type, please select the **"Search Option"** in the Subject FormElement while configuring the Form inside **App Designer**

  <Image align="center" src="https://files.readme.io/c5c15ae-Screenshot_2024-06-10_at_2.35.04_PM.png" />

---

## `readme/Implementers/advanced-feature-guide/reporting-views.md`

title: Reporting Views [Deprecated]
excerpt: ''
Avni has a generic data model to support the dynamic creation of forms. For new implementers wanting to write custom reports, this can be overwhelming and complex.\
To ease the creation of reports, Avni generates simplified database views with one view corresponding to each form.

## Creating / Refreshing Reporting Views

You can create views for reporting by going to the `Reporting Views` option in the app designer and clicking on `create/refresh view`. For each form, one view is created with all the questions as the columns in the view. 

<Image title="Screen Shot 2020-09-04 at 9.28.47 AM.png" alt={3356} src="https://files.readme.io/f47db05-Screen_Shot_2020-09-04_at_9.28.47_AM.png">
  App Designer Reporting Views Screen
</Image>

You can see the view definition by clicking on the expand button, and delete the view by clicking on the delete button.

The views would be accessible in Metabase or any other reporting tool the implementation may be using.

## Naming convention

As PostgreSQL doesn't allow identifiers of length more than 63 bytes, we follow these naming conventions as long as the view name is below 63 characters.

<Table align={["left","left"]}>
  <thead>
    <tr>
      <th>
        Form type
      </th>

      <th>
        View name
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        Registration
      </td>

      <td>
        `{UsernameSuffix}_{SubjectTypeName}`
      </td>
    </tr>

    <tr>
      <td>
        Encounter
      </td>

      <td>
        `{UsernameSuffix}_{SubjectTypeName}_{encounterTypeName}`
      </td>
    </tr>

    <tr>
      <td>
        Encounter Cancellation
      </td>

      <td>
        `{UsernameSuffix}_{SubjectTypeName}_{encounterTypeName}_cancel`
      </td>
    </tr>

    <tr>
      <td>
        Program Enrolment
      </td>

      <td>
        `{UsernameSuffix}_{SubjectTypeName}_{ProgramName}`
      </td>
    </tr>

    <tr>
      <td>
        Program Exit
      </td>

      <td>
        `{UsernameSuffix}_{SubjectTypeName}_{ProgramName}_exit`
      </td>
    </tr>

    <tr>
      <td>
        Program Encounter
      </td>

      <td>
        `{UsernameSuffix}_{SubjectTypeName}_{ProgramName}_{EncounterTypeName}`
      </td>
    </tr>

    <tr>
      <td>
        Program Encounter Cancellation
      </td>

      <td>
        `{UsernameSuffix}_{SubjectTypeName}_{ProgramName}_{EncounterTypeName}_cancel`
      </td>
    </tr>
  </tbody>
</Table>

If the view name exceeds 63 characters we trim some parts from different entity type names to keep it below 63 characters. For trimming, we follow the below rule.

*\{UsernameSuffix}*\{First 6 characters of SubjectTypeName}*\{First 6 characters of ProgramName}\_\{First 20 characters of EncounterTypeName}*

Some view names exceed the character limit even after the above optimisation. In such a case we take away the last few characters and replace them with the hashcode of the full name. Hashcode is used so that the name remains unique.

---

## `readme/Implementers/advanced-feature-guide/structure-import-metadata-excel-excel.md`

title: Introduction to excel based import [Deprecated]
excerpt: >-
next:
  description: ''
  pages:
    - type: basic
      slug: importing-excel-data
      title: Importing Excel data
---
> ❗️ Avni does not support Excel based import any longer, please refer to Admin App based approach to upload data [Bulk Data Upload page](https://avni.readme.io/docs/upload-data#is-the-order-of-values-important)

<br />

We can Import transactional data from excel files. Data can be Subject Registration, Enrolment, Encounters, relationships between Subjects, Vaccinations, etc. The data file, ideally, should have columns like RegistrationDate, FirstName, LastName, DOB, .. in case of Registration, and SubjectUUID, DateOfEnrolment, Program, .. in case of Enrolment, and SubjectUUID, EnrolmentUUID, EncounterType, Name, .. for Encounters. Along with these default fields, all the observations specific to the implementation should be present in the data file.

The definition of those forms cannot be imported this way. Only the data recorded against those forms can be imported this way.

We need a metaData.xlsx file that would work as an adapter between the data.xlsx file and the avni system.  
The data.xlsx file will be provided by the org-admin which should have consistent and tabular data. The metaData.xlsx file defines the relationship between each column and its corresponding field in the avni system/implementation.

## Structure of metaData.xlsx file:

The following are the various spreadsheets within a metaData.xlsx file.

### Sheets

Sheets represent a logical sheet of data. A physical sheet of data can be mapped to multiple logical sheets of data.

<table>
<thead>
<tr>
  <th>Column</th>
  <th>Description</th>
</tr>
</thead>
<tbody>
<tr>
  <td><p>File Name</p></td>
  <td><p>The data migration service is used by supplying the metadata excel file, a data excel file, and a fileName (since the server reads the data excel file via a stream it doesn&#39;t know the name of the file originally uploaded hence it needs to be explicitly provided).  </p>
<p>Only the sheets which have the file name matching the fileName via the API would be imported.</p></td>
</tr>
<tr>
  <td><p>User File Type</p></td>
  <td><p>This is the unique name given to the file of specific types. There can be more than one physical file of the same type, in which case the user file type will be the same but file names will be different.</p></td>
</tr>
<tr>
  <td><p>Sheet Name</p></td>
  <td><p>This is the name of the actual sheet in the data file uploaded where the data should be read.</p></td>
</tr>
<tr>
  <td><p>Entity Type, Program Name and Visit Type, Address</p></td>
  <td><p>Core but optional data to be provided depending on the type of data being imported</p></td>
</tr>
<tr>
  <td><p>Active</p></td>
  <td><p>During data migration, it is possible that there are a lot of files and mapping metadata definition for those files may not be complete. Active flag (Yes or No) can be used to disable sheets that need not be considered for migration when uploaded.</p></td>
</tr>
<tr>
  <td><p>Name of fields</p></td>
  <td><p>One can add multiple columns after this such that it matches the name of a System Field and provides the default value for the entire virtual sheet.</p></td>
</tr>
</tbody>
</table>

#### Sample

| File Name                          | User File Type | Sheet Name | Entity Type      | Program Name | Visit Type | Active | Date of Birth Verified | SubjectTypeUUID                          | Registration Date | Enrolment Date |
| ---------------------------------- | -------------- | ---------- | ---------------- | ------------ | ---------- | ------ | ---------------------- | ---------------------------------------- | ----------------- | -------------- |
| master\_data\_district\_wise\.xlsx | Registration   | AhmedNagar | Individual       |              |            | No     |                        | 8a9b0ef8\-325b\-4f75\-8453\-daeaf59df29d | YYYY\-MM\-DD      |                |
| master\_data\_district\_wise\.xlsx | Enrolment      | AhmedNagar | ProgramEnrolment | GDGS 2019    |            | No     |                        |                                          |                   | YYYY\-MM\-DD   |

### Fields

The mapping for non-calculated fields

<table>
<thead>
<tr>
  <th>Column</th>
  <th>Description</th>
</tr>
</thead>
<tbody>
<tr>
  <td><p>User File Type</p></td>
  <td><p>This is the same as in Sheets.</p></td>
</tr>
<tr>
  <td><p>Form Type</p></td>
  <td><p>[IndividualProfile, Encounter, ProgramEncounter, ProgramEnrolment, ProgramExit, ProgramEncounterCancellation, ChecklistItem, IndividualRelationship]</p></td>
</tr>
<tr>
  <td><p>System Field</p></td>
  <td><p>The concept name is specified in the form.<br/>Or Default field (this can be seen in different importers, See below ).</p></td>
</tr>
<tr>
  <td><p>User Field</p></td>
  <td><p>Name of the column from data.xlsx file</p></td>
</tr>
</tbody>
</table>

#### Default fields for each entity as of Dec 2019

| Subject Registration   | Encounter          | Enrolment       | ProgramEncounter | Checklist       | Relationship     |
| ---------------------- | ------------------ | --------------- | ---------------- | --------------- | ---------------- |
| First Name             | Individual UUID    | Enrolment UUID  | Enrolment UUID   | Enrolment UUID  | EnterDateTime    |
| Last Name              | UUID               | Individual UUID | UUID             | Base Date       | ExitDateTime     |
| Age                    | Visit Type         | Enrolment Date  | Visit Type       | Checklist Name  | IndividualAUUID  |
| Date of Birth          | Encounter DateTime | Address         | Visit Name       | Item Name       | IndividualBUUID  |
| Date of Birth Verified | User               | Exit Date       | Earliest Date    | Completion Date | RelationshipType |
| Gender                 | Voided             | User            | Actual Date      | User            | User             |
| Registration Date      |                    | Voided          | Max Date         | Voided          | Voided           |
| Address Level          |                    |                 | Address          |                 |                  |
| AddressUUID            |                    |                 | Cancel Date      |                 |                  |
| Individual UUID        |                    |                 | User             |                 |                  |
| Catchment UUID         |                    |                 | Voided           |                 |                  |
| SubjectTypeUUID        |                    |                 |                  |                 |                  |
| User                   |                    |                 |                  |                 |                  |
| Voided                 |                    |                 |                  |                 |                  |

Along with these, the implementation-specific observations are also to be mapped.

#### Sample

| User File Type | Form Type         | System Field                         | User Field                     |
| -------------- | ----------------- | ------------------------------------ | ------------------------------ |
| Registration   | IndividualProfile | Individual UUID                      | SiteUUID                       |
| Registration   | IndividualProfile | First Name                           | Site                           |
| Registration   | IndividualProfile | AddressUUID                          | VillageUUID                    |
| Registration   | IndividualProfile | Type of waterbody                    | Type                           |
| Registration   | IndividualProfile | Concerned Govt\. Dept\.              | Concerned Govt\. Dept\.        |
| Enrolment      | ProgramEnrolment  | Silt Estimation as per the work plan | Estimated quantity of Silt cum |
| Enrolment      | ProgramEnrolment  | Individual UUID                      | SiteUUID                       |
| Enrolment      | ProgramEnrolment  | Enrolment UUID                       | EnrolmentUUID                  |

[An example of Metadata.xlsx file](https://docs.google.com/spreadsheets/d/1M0QvcgZ7TagcHvMnTSo3qt-sZHwUDHEiN0T2hlKTn9Y/edit?usp=sharing)  
[An example of Data.xlsx file](https://docs.google.com/spreadsheets/d/19aCEIlODNvJMR68_mGl4Q-Kx6n3qI0Dk4hL0aQ8dwAo/edit?usp=sharing)

> 🚧 UUIDs in Data.xlsx file
> 
> Note that
> 
> - Individual UUID (aka Subject UUID, in this example called SiteUUID), EnrolmentUUID, or any `<Transactional-data UUID>` will have to be manually assigned by the developer before import.
>   - Use tools like uuid: `npm i -g uuid`.
>   - `for n in {1..100}; do uuidgen -r; done` `#to get 100 uuids from CLI`
> - AddressUUID (or Village UUID) will not be available when the data file is provided by the Implmentation. And has to be determined from the `Full Address details` (see example Data.xlsx).
>   - For this get all locations and it's uuid into a `Ref Sheet` in data.xlsx file
>   - do vlookup for uuid by `full address details`

### Google Drive Files

For uploading files (images/documents) you can put the URL of the file. Please follow the following steps:

- Ensure the drive file is shared without any restrictions
- Copy the file link and use this website to get the link that can be put into the excel file to be uploaded - [https://sites.google.com/site/gdocs2direct/?pli=1](https://sites.google.com/site/gdocs2direct/?pli=1)
- Copy the link generated by the above website for your file and put it in the excel/CSV cell.

**Technical link for Avni Team**

_The above website uses the following http request behind the scenes_

`curl 'https://www.google-analytics.com/g/collect?v=2&tid=G-KV5S9LK4WB&gtm=2oe1a1&_p=437198370&gdid=dZWRiYj&cid=1650660276.1673947139&ul=en-gb&sr=1440x900&uaa=x86&uab=64&uafvl=Not%253FA_Brand%3B8.0.0.0%7CChromium%3B108.0.5359.124%7CGoogle%2520Chrome%3B108.0.5359.124&uamb=0&uam=&uap=macOS&uapv=10.14.6&uaw=0&_s=1&sid=1673947138&sct=1&seg=1&dl=https%3A%2F%2Fsites.google.com%2Fsite%2Fgdocs2direct%2F%3Fpli%3D1&dr=https%3A%2F%2Fwww.google.com%2F&dt=Google%20Drive%20Direct%20Link%20Generator&en=page_view&_ee=1' 
  -X 'POST' 
  -H 'authority: www.google-analytics.com' 
  -H 'accept: _/_' 
  -H 'accept-language: en-GB,en;q=0.9,hi-IN;q=0.8,hi;q=0.7,en-US;q=0.6,de;q=0.5' 
  -H 'content-length: 0' 
  -H 'dnt: 1' 
  -H 'origin: https://sites.google.com' 
  -H 'referer: https://sites.google.com/' 
  -H 'sec-ch-ua: "Not?A_Brand";v="8", "Chromium";v="108", "Google Chrome";v="108"' 
  -H 'sec-ch-ua-mobile: ?0' 
  -H 'sec-ch-ua-platform: "macOS"' 
  -H 'sec-fetch-dest: empty' 
  -H 'sec-fetch-mode: no-cors' 
  -H 'sec-fetch-site: cross-site' 
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36' 
  --compressed`

---

## `readme/Implementers/advanced-feature-guide/styling-the-name-of-the-page.md`

title: Colourful forms
excerpt: ''
Implementers can provide the custom background color and text color to the page header(form element group). Although the implementer can choose from any color present in the color palette, we suggest choosing the contrast colors for the background and text so that the page header is visible properly.

Background and text color can be chosen from the option available at the bottom of each page. Once the colors are chosen and the form is saved, it'll be visible in the observation table in the subject dashboard and also while filling the form.

![585](https://files.readme.io/54b0c74-colourful-groups.gif "colourful-groups.gif")

---

## `readme/Implementers/advanced-feature-guide/sync-capabilities.md`

title: Sync capabilities
excerpt: ''
## Offline

Avni works completely in offline mode except during login and sync. The first time sync runs just after login.

## About Sync

* Download - Get data meant for the user from the server onto the device. It is incremental after first sync after login.
* Upload - Uploads any new data created by the user.

| Sync Initiation | Function         | Frequency      |
| :-------------- | :--------------- | :------------- |
| Login           | Download, Upload | NA             |
| Manual Sync     | Download, Upload | NA             |
| Auto Sync       | Upload           | Every hour     |
| Auto Sync       | Download         | Every 12 hours |

<br/>

## More about Auto Sync

Auto sync needs to run in the background when the user is not using the app for data integrity and app availability to the user.

* Battery usage - Upload sync should have minimal device resource usage as it will do anything only if the user has captured any new data. Download sync will run twice in a day and the duration for which it runs depends on Internet quality and amount of incremental data it has to get from the server. Also, if the internet quality is poor the device is mostly be CPU idle during the sync.
  * The users may report unusual battery usage using the Battery Usage in the settings for a period of time > 1 day.

---

## `readme/Implementers/advanced-feature-guide/tasks.md`

title: Tasks
excerpt: ''
Most activities in Avni are modeled as encounters with subjects, sometimes linked to a program. However, there are other kinds of data collection that happens in field work that is not related to any subject.\
eg: A list of contacts that need to be contacted first before creating subjects etc.  

To handle such flows, Avni now has a new mechanism called tasks. Tasks can currently be created only through the external API. They can be assigned to people, who can change the status of a task. 

## Task Configuration

Task configuration is handled currently through SQL inserts since there are no mechanisms on the App Designer. Given below are the new concepts introduced in the task configuration. 

### Task types

A task can have a type. There are currently two kinds of task types - Call and Open Subject. A Call type task helps the user call the user, while the open subject task allows the user to navigate to the subject assigned to the task. 

### Task status

A number of statuses can be configured for a task. This helps in moving these calls into buckets. Some of these cards can be marked as "terminal" tasks. A terminal task indicates that the task is complete. 

### Task search fields

If you configure a list of concepts as task search fields, they are available in the Assignment screen for filtering. This is configured per task type

### Task metadata

Some metadata (concept:value array) can be set on a task when creating it. This will help users get more information on a task before taking actions on them. 

### Task observations

Task observations are filled in when completing a task. A new form type called "Task" is configured for this purpose. The user will be given the option to fill in the form when completing a task. 

### Standard report cards for task

There is a standard report card that can be configured for tasks. This is currently the only way tasks will be visible on the Avni android app. 

## Task assignment

The web application provides a new option - "Assignment" to assign users to a task. Only one user can be assigned to a task at this time. If you assign a new user, the old user is unassigned. 

### Caveats

* Task type configuration does not have an interface on the App Designer. 
* Tasks can only be created through the external API
* Tasks can be assigned through the Assignment feature on the web application
* Tasks are not currently supported on the Data Entry App

---

## `readme/Implementers/advanced-feature-guide/timed-questions.md`

title: Timed questions
excerpt: ''
Questions can be timed in Avni. If you want the user to fill some set of questions after a particular time then you can mark the page as a timed page and specify the time when the questions on the page should be visible. You also set the stay time which forces user to fill all those questions in the mentioned time frame.

## Steps to configure timed questions

Any page can be marked as timed. It is important that you specify the start time and stay time for the timed pages. The start time indicates that the page should start at the provided time and the stay time will keep the question visible till the specified time. Once the stay time is over screen automatically moves to the next page.

<Image title="timed_page.png" alt={1809} src="https://files.readme.io/cf86f77-timed_page.png">
  Example of the timed page in the form
</Image>

There are some assumptions that must be followed to make timed questions work properly.

1. Questions inside the timed page should not be mandatory.
2. If any page is marked as timed then it should not have any visibility rule to hide the entire page. The visibility rule might get ignored.
3. Timer only runs for the first time when filling up the form. Once users have filled in all the timed questions they can go back and edit the entries. Also, the edit flow does not show any timer for the timed questions.
4. If multiple pages are timed and are placed one after the other then the same timer is used for all the pages. Only when there is at least one non-timed page in between two timed page app asks the user to start the timer again.

---

## `readme/Implementers/advanced-feature-guide/translation-management-old.md`

title: Translations
excerpt: ''
    - type: basic
      slug: creating-identifiers
      title: Creating identifiers
---
Avni allows the management of translations using the Admin web interface. Below are the steps to manage translations.

## 1. Add Languages to Organisation Config

First languages have to be added to organisation config. Only the languages that are added in the organisation config are made available to the translation framework

## 2. Download Keys

From the translations page of the Avni Admin app, download the keys after choosing the platform. For the mobile app choose 'Android'. This will download a zip file containing one JSON file per language available in the organisation config. The JSON file will contain keys for both platforms as well as implementation covering all labels in the app, form fields, and any other concepts created in the implementation. The file will contain values for any existing translations. 

## 3. Updating files with translations

The JSON files can be edited with any tool that the implementer is comfortable with. For use cases, where multiple translators are involved or a lot of keys are to be translated we recommend using an external translation management system (TMS) like [Lokalise](https://lokalise.com) which provides a sophisticated editor for performing translations. The TMS provides the ability to import/export JSON files and support a variety of use cases related to translations. Avni has an enterprise-free plan of Lokalise. If you would like to use Lokalise, please request the Avni team to create your account and project to get started.

## 4. Uploading Translations

When downloading translations to a JSON file in Lokalise, under `Advanced settings`, select `Don't export` as value for `Empty translations` field. Once the JSON files are available with updated translations, upload the file in the Avni admin interface by choosing an appropriate language. Be careful about choosing the correct language.

![](https://files.readme.io/d92456b-Screen_Shot_2019-10-21_at_5.58.47_PM.png "Screen Shot 2019-10-21 at 5.58.47 PM.png")

## Translation Dashboard

Once the translations have been uploaded, the translations dashboard will reflect the status. 

The users need to sync their devices to get the new translations.

---

## `readme/Implementers/advanced-feature-guide/upload-checklist.md`

title: Vaccination checklist
excerpt: ''
    - type: basic
      slug: upload-data
      title: Upload data
---
Avni allows you to upload checklist items from web interface. Before uploading checklist make sure you have already created checklist Item form and checklist rule is already in place. As other forms in Avni, each checklist item need to be a concept and should be uploaded/created before uploading checklist json. A sample concept file for vaccination item looks like [this](https://github.com/avniproject/avni-health-modules/blob/master/src/health_modules/child/metadata/vaccinationConcepts.json). You can directly upload these concepts using metadata upload UI.

Once all the dependencies required by checklist are deployed, you can create a checklist json in the UI editor and upload it. A sample Vaccination checklist looks like [this](https://raw.githubusercontent.com/avniproject/calcutta-kids/master/child/checklist.json).

Click [here](https://docs.google.com/spreadsheets/d/e/2PACX-1vS1Xq4cVi1pDn8B78g_BEdQOcqr5p2hTCeuyhXtpZGKGMHCyba7enJop29zYJy9UyEVYeg523lIutQC/pubhtml#) to see more examples.

### Structure of Checklist json file

```json
{
    "name": "Vaccination",
    "uuid": "uuid of this checklist. We support only single checklist in the system right now so don't change this uuid after you save the file for the first time",
    "items": [
        `<item-object>`
    ]
}
```

### Structure of item-object

```json
{
    //uuid of checklist item
    "uuid": "uuid of checklist item",
    //uuid of a form used to mark the vaccine as completed
    "formUUID": "uuid of a form used to mark the vaccine as completed",
    //uuid of a dependency. This item will get due only after the dependency is marked as completed
    "dependentOn": "uuid",
    //Set this when the dependency can expire and you want this item to be scheduled even then
    "scheduleOnExpiryOfDependency": `<boolean>`,
    //Number of days from base date of checklist after which the item becomes due. Put this only if you are also making this item dependent on another item.
    "minDaysFromStartDate": `<integer>`,
    //Number of days from completion date of dependency after which the item becomes due. Put this only if you are also making this item dependent on another item.
    "minDaysFromDependent": `<integer>`,
    //If an item can expire then you can use this to specify it. It's relative from the base date of the checklist.
    "expiresAfter": `<integer>`,
    //Array of status objects. We use this to specify different phases an item can be in. E.g. You may want to define that it's Due from day 2 to day 30, Critical from Day 30 to 60, and Overdue after day 60. 
    "status": "array of `<status-object>`",
    "concept": `<concept-object>`
}
```

### Structure of status-object

```json
{
  //Looks like an unused field right now. Set it in increasing order for now inside status array
  "displayOrder": 1,
  //Days after which this state should be active
  "start": 270,
  //Days after which this state will not be active
  "end": 291,
  //Name of state
  "state": "Due",
  //Color that the item is displayed in when this state is active
  "color": "#FBF9DA"
}   
```

### Strucuture of concept-object

```json
{
  "uuid": "uuid of the concept that should be used for this item",
  "comment": "Put the name of the concept here for readability"
}
```

### Overview

You can use checklist json file to build the checklist. You can do add list of items and for each item define a state like Due, Critical, Overdue. You can also set depedencies between vaccines so the depedent will get scheduled only after dependency is marked as completed.

## Important Questions:

#### How to test?

Change the device date in future. Don't edit date of birth in profile of the subject.

#### How to add a new item?

Add an item-object in items array

#### How to remove an existing item?

Add voided attribute to an item with value true.

#### How do you add a depedency?

Add dependentOn field

#### How is due date calculated when there is a depedency?

A dependent item goes into it's first state after completion date of it's depedency + specified value of minDaysFromDependent. But there can also be a necessity that an item has to be scheduled only after minimum number of days from base date of the checklist. In the case where we have specified both minDaysFromDependent and minDaysFromStartDate then we compute the **max** of both start dates.

```Text Example
max(dependentCompletionDate + minDaysFromDependent + item.start, 
dependentCompletionDate + minDaysFromStartDate + item.start), 
and move the item to it's first state on that date.
```

#### What will happen if my computed due date is after the expiry date.?

An item's due date based on computations of dependent's completion\_date, minDaysFromDependent and item.start, if exceeds the "expiresAfter" value, then we give priority to "expiresAfter" and mark it as expired.

### Flowchart for determining the Vaccination state:

<Image align="center" src="https://files.readme.io/815c13987e5ad6616202a18db078663bae5ec8000d94680642a418ff4e2ca2f3-Flowcharts_2.png" />

### <span style={{ color: "blue" }}>TODOS:</span>

* [ ] It is not clear if there is any default ordering in displaying status groups and is it possible to change it. E.g. we may want to show all due items in first row, all critical in second, overdue in third, expired in fourth and completed in fifth.

---

## `readme/Implementers/advanced-feature-guide/upload-data.md`

title: Bulk Data Upload
excerpt: ''
    - type: basic
      slug: writing-rules
      title: Writing rules
---
### Purpose

* Prepare data in bulk, review, and upload.
* Migrating away from an existing implementation, and need to seed with existing data.
* Your organization has a separate component where data is collected outside Avni, but you still need this data to be present with field workers using Avni.

### Using the Admin app to upload data

The Admin app of the web console has an upload option. Currently, this supports

* Upload subjects
* Upload program enrolment (excluding exit information and observations)
* Upload program encounters (excluding cancel information and observations)
* Upload encounters (excluding cancel information and observations)
* [Upload locations](location-and-catchment-in-avni)
* Upload users and catchments
* Upload metadata zip file downloaded from a different implementation

Sample files are available in the interface. Download the file, fill in values and then upload. The file is in a [CSV](https://www.howtogeek.com/348960/what-is-a-csv-file-and-how-do-i-open-it/) format.

### Form validations and rules

* All the entries in CSV are validated before saving to the database. Suppose a field is marked mandatory in the form and value is not provided in the CSV then upload fails giving the error that the mandatory field cannot be empty. 
* All form element and form element group rules are run during CSV upload, so if there is a value for any form element which is hidden then that value is ignored. This behaves similarly to how data entry is done from the web or mobile app.
* New visits get saved based on the visit schedule logic.
* Decisions are saved along with the observations based on the decision rule logic.

### Questions and Answers

#### What is the Id field in every file?

* The Id is an identifier for the row you are uploading. This is important to ensure that if you upload the same file twice, we do not create duplicate records. For import, this usually should map to the id from your previous system. For updates, you can specify the value for the Id field as the id from your previous system or the uuid generated by Avni when creating the record. If you have two different individuals or encounters to be uploaded, please ensure they are uploaded using different ids. If not, they will be overwritten. The Id can be any string. 

#### What if I have a comma in my observation?

* Wrap your observation in quotes. 

##### What if I need to upload an observation whose concept is not specified in the sample file?

* It is possible you have a computed value that is not part of the form that needs to be uploaded. Just add the concept name in the header, and it will be added to the observations. 

##### Is the order of values important?

* No. Columns can be in any order. 

##### What if I have a concept called "Id"? This will mean there are two headers in the same file with the same name.

* Unfortunately, the upload process does not support this scenario. You can potentially change the name of the concept for a little while until the upload is complete, and then change it back (if you are doing an initial import, this makes sense). If not, try changing the name of the concept (we do an exact case-sensitive string match, so you can change the concept name to something like "ID", and it should work fine).

#### How to upload data for the grouped form elements?

* Columns for the grouped form elements are labeled as "Parent|Child". One can fill in the values for all the child form elements and it'll get saved as grouped observation.

#### How do I upload images?

* For images, use a url that the avni server can download. Ensure that
  * The images are a direct download link (not a redirect to a page that uses javascript to download)
  * The image urls end with the image type. eg: [https://somedomain.com/images/abc.png](https://somedomain.com/images/abc.png)

---

## `readme/Implementers/advanced-feature-guide/user-subject-types.md`

title: User Subject Types
excerpt: ''
A user subject type is a type that can be used to manage information about users of the system. Each user will have one subject created based on a User type SubjectType. This subject and any data collected against it's encounters and enrolments correspond only to that particular user.

## Special Characteristics

* **Subject Type Create / Edit**: Once a User type SubjectType is created, Avni doesnot allow Administrators to modify the basic configurations of the SubjectType. Ensure that you configure the Subject as needed at the outset. Contact Avni Support if you need any modifications to be done for the User type SubjectType.

  * Registration Date for the subject will be same as User Creation DateTime
  * Toggle of 'Allow empty location' is disabled and is always set to true
  * User's username is inserted as Subject's Firstname
* **Subject Type Create / Edit**: You may only edit the below shown properties post SubjectType creation.

<Image align="center" width="600px" src="https://files.readme.io/ba11a11-Screenshot_2024-05-17_at_3.40.56_PM.png" />

* **Sync**: By default, User type Subjects follow their own Sync strategy, which is currently, to sync a User type Subject only to its corresponding User
* **Subject Creation**: On creation of a "User" type SubjectType, we **automatically** create User type subjects :
  * for every new User created thereafter via the "Webapp" 
  * for new Users created via "CSV Uploads", by triggering a Background Job
  * for all existing Users, by triggering a Background Job
* **Ability to Disable Registration of User type SubjectTypes on Client**: Currently, Avni allows an Organisation Administrator to disable User's ability to create any new User Subject Type Subjects on client, by following the below steps:

  1. Navigate to "App Designer", Forms Section

     <Image align="center" src="https://files.readme.io/af7a60f-Screenshot_2024-05-17_at_3.51.29_PM.png" />
  2. Click on the "Gear Wheel" icon, to load the Form-Mapping Edit view

     <Image align="center" src="https://files.readme.io/2c4cffc-Screenshot_2024-05-17_at_3.52.44_PM.png" />
  3. Click on the "Bin (Delete)" icon to Void the Form to Subject type association (Form Mapping)
* **Access to User type Subject on the client**: Users cannot make use of "Subject Search" capability to access the User type Subject on the Client. They would always have to make use of "Filter" button on "My Dashboard" to select the User type Subject, as shown below.

<Image alt="Select User type in the Subject Filter" align="center" width="500px" border={true} src="https://files.readme.io/f265252-Screenshot_2024-05-17_at_4.23.24_PM.png">
  Select User type in the Subject Filter
</Image>

For organisations that use a Custom Dashboard as the Primary Dashboard, they can easily configure a Offline Report card to provide access to User type Subject.

* **Actions allowed on the User type Subject**: Avni allows organisation to configure a User type Subject similar to the way they would configure a "Person" / "Individual" type Subject types. i.e. they are free to setup Program, Encounter, VisitScheduleRules and so on. They can also configure Privileges in-order to restrict these actions across different UserGroups. A sample screen recording of the client, which has full access to a User type Subject is attached below for reference.

<Image align="center" className="border" width="500px" border={true} src="https://files.readme.io/d966e6d-output.gif" />

---

## `readme/Implementers/advanced-feature-guide/whatsapp-integration.md`

title: Whatsapp integration
excerpt: Talk to your beneficiaries through Whatsapp
## Purpose

Being able to communicate to your beneficiaries through Whatsapp is very powerful in many scenarios of field work. It can be used to provide reminders for important events or your field-worker's visit. You can provide nudges for those who need to be follow a routine. 

#### Use cases

1. Remind everyone in a village about an upcoming Village Health and Nutrition Day (VHND)
2. Remind pregnant mothers about an upcoming ANC visit
3. Send motivational videos to all users enrolled into a de addiction programme
4. Inform a student about an upcoming interview
5. Remind a teacher and their principal about an observation session the next day
6. Remind field-workers to submit their monthly reports

## How it works

<Image align="center" width="350px" src="https://files.readme.io/5faa756-Screenshot_2023-10-13_at_1.28.13_PM.png" />

Avni uses [Glific](https://glific.org/) to send Whatsapp messages to beneficiaries and users. Glific is not just a way to connect to Whatsapp. It also provides rich communication between beneficiaries through chatbots. Glific also provides a neat way for two-way communication between beneficiaries. 

If an organisation uses Avni, a lot of information about the user is available in Avni. More importantly, Avni also understands when an important event has either happened, or is about to happen. Due to this reason, Avni is well-placed to provide reminders and nudges where they are necessary. Avni-Glific integration has three pieces. 

1. Sending of a message on a trigger. Triggers can be registration of a user, enrolment into a program or completion of a visit. When such a trigger happens, Avni can send a message to Glific at a scheduled time. 
2. Bulk send of messages for a group of users. Sometimes, the organisation needs to share a piece of information to their entire set of beneficiaries, or a sub-group within it. This can be done through a web-based mechanism
3. Sending of messages to an individual and viewing sent messages on the Avni field-app

**PS**: Interested organisations must create an account in Glific and configure Glific in Avni in order to use this functionality

### Sending messages on a trigger

In the application designer, there is an option within subject types, programs and encounter types to provide 

1. A schedule rule that specifies the time in which the message needs to be sent (once the event is triggered)
2. A message rule that helps figure out the parameters required for the message

The messages are scheduled when the event is synced to the server (or at save if you are using the Data Entry Application). 

#### Setup

First, you need to enable messaging in the Organisation Settings on the Admin page

![](https://files.readme.io/69637ed-image.png)

Next, provide details to connect to Glific into the external\_api table. This currently does not have a UI. Entries need to be made in the format. 

`insert into external_system_config(organisation_id, version, created_by_id, last_modified_by_id, created_date_time, last_modified_date_time, system_name, config)
values (2, 1, 1, 1, now(), now(), 'Glific', '{"baseUrl": "API URI field value from password manager", "phone": "Login for API field value from password manager", "password": "Password field value from password manager", "avniSystemUser": "maha@test"}'::jsonb);`

Ensure that atleast one of your form fields is marked as a phone number. This can be done by going to a **Text** or **PhoneNumber** concept, and marking its "contact\_number" value to "yes". Use this concept in the form to register the subject. It is to the value of this field, that the whatsapp message will be sent.

<Image align="center" className="border" border={true} src="https://files.readme.io/4f4f325-Screenshot_2022-11-14_at_7.07.26_PM.png" />

Once this configuration is complete, go over to the App Designer and create rules to send messages. 

There are 2 rules to be configured here. The first (Schedule rule) determines the time when the message needs to be sent. The second (Message rule) gives the parameters on the message. These parameters can be fetched from any part of the entity. The message rule should return the computed array of parameters for this entity. 

You can choose to send the message to either the subject/beneficiary or the user who made the entry. 

You can also have multiple rules defined for the same trigger. In this case, you can have a message to be sent immediately, and another to be sent after a week.

You also have the ability to not schedule a message if required by setting the `shouldSend` parameter in the response of the Schedule Rule to false. If this parameter is not set, it defaults to true i.e. the message will be scheduled.

![](https://files.readme.io/cbed815-image.png)For sending messages, for the entities(subject/encounter/enrolment) created in mobile app, the created data in mobile app should have been synced to the server.

### Bulk send of messages for a group of users

![](https://files.readme.io/958a89d-image.png)

Under Broadcast section of the Avni web application, you will now see a new option - WhatsApp. This can be used to send messages to beneficiaries, users or groups. 

Check [this](https://drive.google.com/file/d/1J2qt1s2ltJoOjQoWXdmq1GZA171usPsq/view?usp=share_link) video out, to know how to manage groups and send messages to groups.

Currently only name of the subject/user is supported as dynamic parameter. To use this, enter `@name` in the parameter input field.

### Limitations

Currently, only HSM messages is in scope of this integration. Eventually, the integration will also include triggering workflows in Glific.

### Viewing messages for a Subject, User or a Group

Currently, through the web-app, we are able to look at the Sent and Scheduled messages for a Subject, User or a Group, with a caveat that only the latest 100 messages are fetched. This is due to performance constraints in Avni-Glific data fetch.

### Debugging

* To understand the db design for debugging, checkout [this](https://avni.readme.io/docs/understanding-whatsapp-integration-tables#to-understand-the-status-of-automatic-messages) and [this](https://dbdiagram.io/d/63bb840e7d39e42284e9a83d) link.
* To view the logs printed when executing message rule or schedule rule execute the following after ssh-ing into the server machine:

  ```
  sudo su - rules-server-user
  pm2 logs --lines 1000
  ```
* If expected message not delivered, can check in the glific webapp (credentials in keeweb) to see if any error displayed beside the message in the chat. Sometimes say, when the phone no is invalid or the expected no of parameters not mentioned, an error message stating the reason for inability to deliver the message gets displayed in the chat.
* The background job that runs for sending messages from message\_request\_queue table is currently configured to run once in 5 mins.
* In order to handle scenarios where either system is unavailable, the background job retries messages that were not successfully sent. Messages older than a certain period are not retried. Default: 4 (days); Configuration: `AVNI_SEND_MESSAGES_SCHEDULED_SINCE_DAYS`

---

## `readme/Implementers/advanced-feature-guide/when-to-use-translations.md`

title: When to use Translations
excerpt: ''
Since the issue of change in concept name has come up a few times - in terms of what impact it would have on rules. Also, we use uuid for concept as the name can change - but this reduces readbility of the rule.\
Here is a mental model to think about this.

Concept name, form element name should be considered programming keywords - representing an idea.\
e.g. Mother's name\
When we name a concept/element in app designer we are defining a name for it in the programming realm not in the user realm.

How this idea is presented to user is using an English translation or another language translation.\
What does English translation represent?\
It represents a mapping from the idea to a view for the user.

So two realms - programming and user.\
What is the benefit of this?

As long the the core idea doesn't change, there is no need to change the name of the concept/element.\
e.g. if the customer says we want to call it - Name of mother - then it is a change only in the user's realm not programming realm.

So we can simply change/add a translation for it based on the user/customer's preference. The translation feature offers a decoupling between programming and user realm.

Following from this, there is no need to use UUID of the concept in the rule. Why? Because once the concept/element name is defined, there is no need to change it based on what user/customer wants it to be named.

Concept/element should be renamed only if there is a semantic change in the idea behind it - this happens very rarely.

If there a typo in the name, then you can change it, but remember there is cost to it - which may or may not be worth paying - depending on how deep you have been in the cycle of the project.\
Avni has been designed such that almost everything can be shown to the user in their own language.\
But what also follows from this is - everything is also defined separately in the programmer and user realms.

---
