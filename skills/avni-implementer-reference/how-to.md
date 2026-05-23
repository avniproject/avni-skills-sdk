# How-do-I guides

> 12 sections vendored from `avniproject/avni-ai/dify/merged.md` (branch `app-configurator-dev`).
> Regenerate via `node scripts/build-implementer-reference.mjs` when upstream changes.

---

## `readme/Implementers/how-do-i/accessing-media-in-reports.md`

title: Access media in reports
excerpt: ''
Data in Avni is stored in two different data sources. The first is the postgres database, which are easily connected to the reporting servers that are being used by hosting. The second is an S3 database where media is stored. 

In reporting tools, there is a mechanism to show data by connecting to a data source. However, S3 access is usually not provided. In case you need to expose media through reports, here is what you need to do. 

1. Provide users access to Avni. 
2. In reports, observations are usually of the form "[https://prod-user-media.s3.ap-south-1.amazonaws.com/org\_name/file\_name.png"](https://prod-user-media.s3.ap-south-1.amazonaws.com/org_name/file_name.png"). This will be stored in observations of the form. To provide a link that shows this, change it to the form " [https://app.avniproject.org/web/media?url=https://prod-user-media.s3.ap-south-1.amazonaws.com/org\_name/file\_name.png"](https://app.avniproject.org/web/media?url=https://prod-user-media.s3.ap-south-1.amazonaws.com/org_name/file_name.png"). 

Doing this will send the user to app.avniproject.org, which will redirect the user to the corresponding media once they have authenticated themselves on avniproject.

---

## `readme/Implementers/how-do-i/choose-colours-for-offline-report-cards.md`

title: Colours for Offline Report Cards
excerpt: >-
  description: ''
---
<Image align="center" src="https://files.readme.io/71e201dc45bef425cb65222621d02e8a698eeef4c2a95033664bd1a5c5d70808-Screenshot_2025-07-28_at_4.58.22_PM.png" />

---

## `readme/Implementers/how-do-i/choosing-android-device-for-avni.md`

title: Choosing android device for Avni
excerpt: ''
We are listing down some criteria which could help you in deciding which device to choose. The price range kept in this analysis is between 7000 to 10000 Indian Rupees.

**OS Version**: While Avni will work on version >= 5.0, but if you are purchasing a new device then it is better to go for a more recent version. Realistically though setting the bar too high will reduce your options. Hence we recommend version >= 11.

**RAM**: Primary memory >= 4 GB is minimum requirement for quick response during app launch or screen transitions. Recommend devices with memory >= 6GB.

**CPU Speed**: Minimum requirement is a 64-bit ARM processor, with atleast 4 cores clocked at 2.0 GHz. Recommend Octa-core devices clocked at >= 2.0 GHz.

**Storage**: >= 64 GB is required for ensuring Phone OS version and all installed app versions are up to date, while retaining enough space to store media content for extended period of time.

**SD Card**: Avni in future may allow for keeping an additional backup of the data on the SD card. This is to protect against corruption of main data on internal storage which is not completely synced up with the server. Required only if your device has less than 64GB of Storage on itself.

**Screen Size**: For users who will use the application quite often, we recommend 6 inches as ideal, also considering the ability to carry it. You can, of course, go for higher or lower based on your preference.

**Camera**: A minimum of a 8MP camera will be required for good resolution images of the field work. Higher is also fine, but keep in mind that, the higher resolution requires more network bandwidth to upload. The storage of device will also need to support.

**Network Support**: Avni just needs a network connection. It could even work on 2G connectivity, but again, given that you are buying a new device go for devices which can work with 4G networks. Devices with 5G support are also fine, if they are tuned to work with 4G networks in low network availability scenarios. 

**Battery Life**: Once you have multiple devices that you can compare, look for their mAh rating. Higher is better.

---

## `readme/Implementers/how-do-i/complex-visit-schedule-testing.md`

title: Complex Visit Schedule Testing
excerpt: ''
If we break down the visit schedule complexity into three levels simple to complex, we would notice that the testing mechanism for level 2 & 3 visit schedules are quite wasteful due to long feedback loops. The feedback loop is long mainly because the testing of visit schedule logic requires filling forms to setup data and to see the result. In development mode performing sync the second main reason the feedback loop is long.

It is important to remember that for most (may be not all) bugs the testing of all the scenarios need to be carried our all over again. After certain number iterations of such testing the testing fatigue is likely to kick-in, compromising quality as well.

This feedback loop can be shortened significantly by following age old unit testing written in the form of business specifications. This approach improve quality and reduce waste.

Business specification style will allow for customer, business analyst, developer and testers all to come on the same page about the requirements. Automation of unit tests allows for verification of production code against the specification - repeatedly.

## Business specification style tests

These are tests that are written such that they read close normal english using the language of problem domain, but they can be executed as well. It helps in understanding the basic structure of such tests which is capture in a three step process - **given, when, then**. It would be useful to quickly read about it, if you don't know about this already. One such article is [here](https://www.agilealliance.org/glossary/given-when-then/), but there are many.

### Example

This is one test for scheduling visits on edit of an ANC Visit - [https://github.com/avniproject/apf-odisha-2/blob/main/test/ANCTest.js#L117](https://github.com/avniproject/apf-odisha-2/blob/main/test/ANCTest.js#L117).

**Given** that the for beneficiary ANC-1 visit is completed and ANC-2 visit is scheduled for the next month

**When** ANC-1 is edited

**Then** PW Home or ANC visit should not be scheduled

## QA strategy

Visit schedules for which such unit tests have been written should be tested differently.

* Review the test scenarios already automated via these tests.  If any scenario is missing, request the developer to add those scenarios to the test suite.
* Pick a handful, not too many, of these to verify whether the mobile application is indeed working in the same way as well.
* **Most importantly - do not manually run all the scenarios.**

## For developers

* Jest - [https://jestjs.io/docs/api](https://jestjs.io/docs/api)
* It is important to learn about test lifecycle and setup, teardown, describe, test/it methods. [https://jestjs.io/docs/setup-teardown](https://jestjs.io/docs/setup-teardown)
* It is important the each test (test/it) runs independent of other tests, so that execution of one test doesn't have any impact on another test. To achieve this all variables should be instantiated in each test, i.e. in move all the code common instantiation code (not functions) to beforeEach. Do not instantiate anything outside beforeEach and it/test. Unit tests run super-fast so optimisation is not useful and is in fact counter-productive.

---

## `readme/Implementers/how-do-i/get-bulk-data-out-of-avni.md`

title: Get bulk data out of Avni
excerpt: ''
## Transaction data

*i.e. Subjects, Encounters, Enrolments etc.*

There are a few options available suited for different purpose.

### 1. Longitudinal Export

Use this if the purpose is to get all the data associated to a subject in a single row. Also see - [New Longitudinal export](doc:new-longitudinal-export). Note currently there is a limit of 10,000 rows in this export. One can use date ranges to get data in parts.

### 2. Download Metabase tables

Metabase automatically recognises all the tables in the data source that it is pointed to. Hence, on browsing to the implementation specific schema one can see all the ETL tables. Metabase allows the ability to download the data for each table. A few points to consider/know:

a. Although in the display Metabase has limit of 10,000 rows. There is no such limit on downloads.

b. These downloads are per-table with foreign keys to parent tables (e.g. encounter form tables will have foreign keys for program enrolment, subject ETL tables). The consumer of this data will have to join these themselves in their analytics solution.

c. Download operations currently are not metered. This may change in future, if we see performance impact on the reporting database. It is recommended that these downloads are done after hours, lets say after 6 pm - so that it doesn't impact other reporting operations.

### 3. Download custom query data (SuperSet and Metabase)

This can be used to provide custom downloads based on queries. This can get around any limitations of approach 2 above in terms of the shape of downloadable data. e.g. One can join Subject, Enrolment in encounter and provide a report that one can use to download subject, enrolment, identification data along with encounter data.

The point 2(c) applies to this as well.

---

## `readme/Implementers/how-do-i/how-to-guide-installing-avni-field-app-and-basic-set-up-on-your-mobile-phone.md`

title: 'How To Guide: Installing Avni Field App and Basic Set-Up on your Mobile Phone'
excerpt: >-
  robots: index
next:
  description: ''
---
**Step 1: Install the Avni app from Google Play Store**

1. Go to the Google Play Store on your mobile device
2. Type **Avni** on the search bar
3. Click on **Install** to download the app

<br />

<Image align="left" className="border" width="250px" border={true} src="https://files.readme.io/b2ec7c3-Playstore.JPEG" />

<Image align="left" className="border" width="250px" border={true} src="https://files.readme.io/e07f14d-Avni.JPEG" />

<br />

<Image align="center" className="border" width="250px" border={true} src="https://files.readme.io/daf3937-Install.JPEG" />

**Step 2: LOGIN**

1. LOGIN to the app by entering your User ID and Password
2. Click on the LOGIN button

Note: The User ID and Password is sent to the registered mobile number via SMS once the user is created in Avni Web Console

<br />

<Image align="center" className="border" width="300px" border={true} src="https://files.readme.io/99d67fd-LOGIN.JPEG" />

<br />

**Step 3: Basic Set - Ups**

a) **Sync**

It is important to sync the app whenever an internet connection is available for the new data to get stored and reflect in the app Dashboard. This can be done by clicking on the Sync button at the top right

<br />

<Image align="center" className="border" width="300px" border={true} src="https://files.readme.io/4f2e86b-Sync2.JPEG" />

<br />

b) **Language:**

By clicking on the Edit Settings button at the top, you can select the language in which you want to see the app content. The default language selected is English

<br />

<Image align="left" width="250px" src="https://files.readme.io/75ffcfa-Edit_Lang.JPEG" />

<Image align="center" width="250px" src="https://files.readme.io/f9de6e9-1712641958848.JPEG" />

**c) Change Password**: 

If you wish to change your password, you can do so, by clicking on the Change Password button and entering the new password details.

<br />

<Image align="left" className="border" width="250px" border={true} src="https://files.readme.io/5b1f088-Change_Pass.JPEG" />

<Image align="center" className="border" width="250px" border={true} src="https://files.readme.io/69adaa1-Password.JPEG" />

---

## `readme/Implementers/how-do-i/migrate-location-of-subject.md`

title: Migrate location of subject
excerpt: ''
# Please refer to API Doc

[https://editor.swagger.io/?url=https://raw.githubusercontent.com/avniproject/avni-server/master/avni-server-api/src/main/resources/api/external-api.yaml](https://editor.swagger.io/?url=https://raw.githubusercontent.com/avniproject/avni-server/master/avni-server-api/src/main/resources/api/external-api.yaml)

# Documentation Deprecated

Since there are multiple entities that need to be changed, the migration should not be done by making changes directly to the database using SQL commands. In order to migrate a subject use the follow API.

### Endpoint

`{{origin}}/subjectMigration/bulk`

e.g. [https://app.avniproject.org/subjectMigration/bulk](https://app.avniproject.org/subjectMigration/bulk)

### Headers

`auth-token`

### Body

* destinationAddresses is a map of source address level id and destination address level id.
* subject type ids is an array of subject types that you want migrated

```Text JSON
{
    "destinationAddresses": {
        "330785": "330856",
        "334657": "335043",
        "331106": "331466"
    },
    "subjectTypeIds": [
        672,
        671
    ]
}
```

### Also know

* if you have a lot of addresses then the request may timeout, but the server will continue to process
* Each source to destination mapping for each subject type, will be done in its own transaction. So for above example there will be 6 transactions (3 address mapping multiplied by 2 subject types).

---

## `readme/Implementers/how-do-i/move-org-to-custom-dashboard-from-mydashboard.md`

title: Move Org to Custom Dashboard from MyDashboard
excerpt: ''
1. As super admin, call `POST /api/defaultDashboard/create?orgId=[organisationId]` (`organisationId` being the id of the organisation for which you want to create the default dashboard - typically your UAT org)
2. This API will only create the default dashboard for non Prod orgs.
3. Assign the newly created dashboard to the required user groups.
4. Test and verify functionality in UAT org
5. Upload bundle from UAT org to live org.

---

## `readme/Implementers/how-do-i/review-implementation-bundle.md`

title: Review Implementation Bundle
excerpt: ''
Avni offers the ability to export the configuration and metadata from an implementation into a bundle ([App Designer -> Bundle](https://app.avniproject.org/#/appdesigner/bundle)). This bundle can then be uploaded into another implementation if it is required to have the same metadata and configuration setup ([Admin -> Upload](https://app.avniproject.org/#/admin/upload) ).

Since this a feature with widespread consequences if the wrong bundle is used on the wrong implementation, the implementer can review the changes that will be affected as a result of uploading a bundle before applying it. The option to review the changes is displayed after selecting the upload type as 'Metadata Zip' on the upload screen and uploading the bundle.

<br />

On clicking 'Review', the uploaded bundle is compared against the implementation that the user is currently logged into and a file by file list of differences is displayed on screen. The file listing categorises the changes as additions (green), modifications (orange), removals (red) or if completely new items will be created if the bundle is applied.

![](https://files.readme.io/2582a6ae1664ad643eb9421b4cd7484d0d8baa00c480a9d13c36b60e6e8d8dbb-image.png)

<br />

On selecting a file, the details of the changes in that file are shown. The implementer can use the 'Back to Upload' option to return to the upload screen after reviewing the changes to change the bundle file used or apply the bundle.

![](https://files.readme.io/312f6da0ac043d3048fc4837f167416132de631a8d193084d809e81a63988fc8-metadata-diff.webp)

---

## `readme/Implementers/how-do-i/updating-rules-in-bulk.md`

title: Update rules in bulk
excerpt: ''
```sql
set role <organisation_db_user>;

-- Subject Type
update subject_type set
    program_eligibility_check_rule = replace(program_eligibility_check_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
    last_modified_date_time = current_timestamp
    where program_eligibility_check_rule like '%ruleServiceLibraryInterfaceForSharingModules%';
update subject_type set subject_summary_rule = replace(subject_summary_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                        last_modified_date_time = current_timestamp
    where subject_summary_rule like '%ruleServiceLibraryInterfaceForSharingModules%';

-- Encounter Type
update encounter_type set encounter_eligibility_check_rule = replace(encounter_eligibility_check_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                          last_modified_date_time = current_timestamp
    where encounter_eligibility_check_rule like '%ruleServiceLibraryInterfaceForSharingModules%';

-- Program
update program set enrolment_summary_rule = replace(enrolment_summary_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                          last_modified_date_time = current_timestamp
    where enrolment_summary_rule like '%ruleServiceLibraryInterfaceForSharingModules%';
update program set enrolment_eligibility_check_rule = replace(enrolment_eligibility_check_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                          last_modified_date_time = current_timestamp
    where enrolment_eligibility_check_rule like '%ruleServiceLibraryInterfaceForSharingModules%';
update program set manual_enrolment_eligibility_check_rule = replace(manual_enrolment_eligibility_check_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                          last_modified_date_time = current_timestamp
    where manual_enrolment_eligibility_check_rule like '%ruleServiceLibraryInterfaceForSharingModules%';

-- Form
update form set decision_rule = replace(decision_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                   last_modified_date_time = current_timestamp
where decision_rule like '%ruleServiceLibraryInterfaceForSharingModules%';
update form set validation_rule = replace(validation_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                   last_modified_date_time = current_timestamp
where validation_rule like '%ruleServiceLibraryInterfaceForSharingModules%';
update form set visit_schedule_rule = replace(visit_schedule_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                   last_modified_date_time = current_timestamp
where visit_schedule_rule like '%ruleServiceLibraryInterfaceForSharingModules%';
update form set checklists_rule = replace(checklists_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                   last_modified_date_time = current_timestamp
where checklists_rule like '%ruleServiceLibraryInterfaceForSharingModules%';
update form set task_schedule_rule = replace(task_schedule_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                   last_modified_date_time = current_timestamp
where task_schedule_rule like '%ruleServiceLibraryInterfaceForSharingModules%';

-- Form element

update form_element set "rule" = replace("rule", 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
					last_modified_date_time = current_timestamp 
where rule like '%ruleServiceLibraryInterfaceForSharingModules%';

-- Form element group

update form_element_group set "rule" = replace("rule", 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
					last_modified_date_time = current_timestamp 
where rule like '%ruleServiceLibraryInterfaceForSharingModules%';

-- Report Card
update report_card set query = replace(query, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                last_modified_date_time = current_timestamp
where query like '%ruleServiceLibraryInterfaceForSharingModules%'

-- Organisation Config
update organisation_config set worklist_updation_rule = replace(worklist_updation_rule, 'ruleServiceLibraryInterfaceForSharingModules', 'imports'),
                last_modified_date_time = current_timestamp
where worklist_updation_rule like '%ruleServiceLibraryInterfaceForSharingModules%';
```

One example is illustrated here, one can change the text and replace with something else.

---

## `readme/Implementers/how-do-i/upload-local-database.md`

title: Upload local database
excerpt: ''
Many times, the local database of the Android app provides clues to an issue happening on that device. Avni provides a mechanism to send a backup of the local database to Avni so that a developer can recreate this issue and perform fixes if required. 

To upload your local database, go to the "More" section on the home page and press on the "Upload Database" menu item. 

<Image align="center" width="500px" src="https://files.readme.io/be788e5-Upload_Database.png" />

---

## `readme/Implementers/how-do-i/validate-a-new-implementation-for-user-acceptance-test-purposes.md`

title: Validate a new Implementation for User Acceptance Test Purposes
excerpt: ''
<br/>

**UAT Test Scenarios** 

**Step 1: Download the Avni App** from Playstore to proceed with the test cases given below.

![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.001.png)

**Step 2: Login :**

* **Valid User Login:** Verify that a user can successfully log in with a valid username and password. (Ex. Username: xyza\@ProjectName, Password: xyza7988)

* **Invalid User Login:** Confirm that the system handles login attempts with invalid usernames and passwords.

* Test Ex. 1:** With an invalid username and valid password (Authentication error)

  Username: xy\@ProjectName, Password: xyza7988

* Test Ex. 2: With an invalid username with space applied anywhere in the user (Error should be displayed as incorrect username)

  User name: xyza\@cini\_uat, Password: xyza7988

* Test eg 3: When the user name is incorrect, it does not exist in the system. It will give an authentication error

* ` `Username: dinesh or dineshProjectName, Password: dine7988

* Test eg 4:** With a valid username and invalid password (Authentication error)

  Username: xyza\@cini\_uat, Password: xyza798

* Test eg 5:** With a valid username and invalid password special characters (Authentication error)

  Username: xyza\@cini\_uat, Password: xyza\@7988

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.002.png)

* **Password Visibility**: Ensure the password field can be shown or hidden upon using the ‘show password’ toggle.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.003.png)

* **Forgot Password:** Forgot password option on the login page allows the user to generate a new password.

* By clicking on the forgot password, user can see the page where the registered user ID needs to be submitted. On providing the correct user ID, a pop-up will be displayed ‘We have sent an OTP on your registered Mobile Number’.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.004.png)![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.005.png)

* With that, the next page will be displayed with 3 fields to enter the one-time password received on the mobile number, the old password, and the new password.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.006.png)

* By successfully submitting all the details, the user can change the password and log in with the user ID and new password.

**3. Home Page:**

* **Home Dashboard:** The home page would have a dashboard to populate the aggregate (count) of different types of data, Ex. number of registrations, number of visits due, number of visits overdue, number of enrolments in the program, etc. By clicking on any of these cards, a list of individuals or other subjects will be displayed where the user can view profiles and details submitted in the registration form of any individual.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.007.png)

* Home Dashboard can have filters to update the data as per date or any other parameter to display card’s data accordingly.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.008.png)

**Last 24 Hours Statistics:**

* **Last 24 hours registration:** The user should be able to see the count of Registered individuals and click on it to list the details               
* **Last 24 hours visits:** The user should be able to see the count of Visits and click on it to list the details   

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.009.png)

**4. Sync:**

* Sync button available on top right corner of the home page, allows user to sync the registration, enrollments, visits and changes done to the existing data.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.010.png)

* By clicking on the sync button, system syncs the changes done in particular in device’s app with server. Data synced in app can be seen in the reports.

* Number shown on the sync button suggests the changes are which ready to be synced.

* A successful sync would display a pop-up as shown below and If sync isn't done popularly or it displays some error like a Fatal error or Association error we have to contact the administrator ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.011.png)

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.012.png)

* If sync fails with the reason Network request then users have to check the internet connection and try to resync.

**5. Registration:**

* The register section should allow the user to register the subjects as per the project, Ex. Individuals, Anganwadi, Camps, Patients, etc.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.013.png)

* The user should be able to save, register the registration form, and proceed to the next registration form.
* After Registering the individual/any other subject in the mobile app, sync the data and validate that the data is reflected in the web app
* Register the individual/any other subject in the mobile app. Do not sync and validate that the data is not reflected in the web app.
* Register the individual in the mobile app using without turning on the network. Turn on the network, don't sync the data, and validate that the data is automatically synced after 10 minutes.

**6. Search Page:**

* Click on the Search button
* Select the subject (i.e. individual, camp, student, etc.) under Choose type, select other filters and click on Submit.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.014.png)

* On the search page, option called included voided if the user toggles it and clicks on the search it should display all the voided and unvoided data
* The result should display the list of subjects as per the filter provided. Along with the list of subjects, ‘Total matching results will be displayed’ to populate the count of subjects as per the filter provided.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.015.png)

* Please note that user can use any combinations of filter simultaneously to populate the results as required.

**6. More Page:**

* **Edit Settings:** In the ‘More’ section, the user should be able to click on the user icon to open ‘edit settings’. The edit setting should have configuration fields of Language, Location, Dashboard, and Auto-sync as shown below.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.016.png)

* In the **Language,** select the language the app content should be displayed and the app content should be displayed in the selected language. The default language is English

* If the language is not updated as select in the ‘edit settings’, then it is a bug.

* **Track location,** if it is enabled it will ask the user for permission if the user accepts the permission then it will capture the longitude and latitude of the current location

* Track location if it is disabled or they refuse to give the permission then it should not capture the user's location

* **Dashboard Auto-Refresh,** disabling this toggle would restrict the user from seeing updated version automatically

* If the user disables the auto refresh then the dashboard should not update the data on the dashboard automatically.

* **Auto Sync,** if the user enables the auto sync then data should sync automatically for every 10 minutes

* If the user disables the auto sync then data should not be synced automatically.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.017.png)

* **Dashboard,** click on this it should display offline dashboards where aggregate cards of different visits due/overdue, registration, and enrolments are done.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.018.png)

* By opening the aggregate cards given on the dashboard, the user can see the list of individuals/subjects and their profiles which aggregates to a count in the dashboard. (Refer to point#7 Profile more details)![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.019.png)

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.020.png)

* **Entity Sync Status**

* **Setup Fast Sync**

* **Change Password,** click on it directly to the password change page

* Users can enter their current password

* The user should be able to enter the new password

* Password Visibility, ensure the password field can be shown or hidden upon user selection.

* Password Visibility (Toggle): Verify that toggling the password visibility option works as intended.

* Password mismatch if the user gives the current password as invalid then it should display the incorrect password or user ID

* Forgot password, If the user doesn't remember the current password while clicking on it. It will send you the OTP using that user enters the new OTP and also a new password

* Password mismatch if the user gives the mismatch value for Enter a new password and Confirm new password then it should display an error password mismatch

  Eg: Enter a new password: din123, Confirm new password: din321

* Password successfully: if the user gives the match value for Enter new password and Confirm new password then it should display password changed successfully.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.021.png)

* **Logout** should help the user close the current session and return to the login screen. Upon clicking the logout button, the user should be able to see a pop-up to confirm to end the current session and logout.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.022.png)

**7. Profile:**

* **Subject Profile:** The profile should typically contain details submitted in various forms and will populate details of enrollment and forms that are scheduled and filled previously.
* Subject profile would typically have name, gender, age, address on top.
* Profile page would contain the list of program subject enrolled to along with the option to enroll in a new program if eligible but not enrolled yet.
* Profile page would have the summary section to display important details which are filled in different forms.
* Profile would also contain visit planned which would display the visit scheduled along with completed visits section.

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.023.png)![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.024.png)

  ![](Aspose.Words.e7a1731f-5ee8-4023-8075-158ab95af182.025.png)

**Important note:**

**The changes done in the application should be synced to save these changes on the server. Sync can be done manually from the button on the home page's top right corner.**

---
