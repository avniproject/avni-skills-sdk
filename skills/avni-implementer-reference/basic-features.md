# Basic feature guide

> 13 sections vendored from `avniproject/avni-ai/dify/merged.md` (branch `app-configurator-dev`).
> Regenerate via `node scripts/build-implementer-reference.mjs` when upstream changes.

---

## `readme/Implementers/basic-feature-guide/avnis-domain-model-of-field-based-work.md`

title: Avni's domain model of field based work
excerpt: ''
    resulting in a working application specific to your
    organisation/implementation.
  pages:
    - type: basic
      slug: key-system-and-data-flows
      title: Key system and data flows concepts
---
To understand how Avni works lets first understand the domain model of field-based work. Any field-based work can be broadly subdivided into three components.

1. **Service delivery organisation** - The organisation, with providers and the geographical area where they work.
2. **Services (or schema of data to be collected)** - The actual set of services provided by the above organisation to the people (or data to be collected about something in a said geographical area).
3. **Service encounter** - Each service is broken down into a discrete set of type of encounters that providers of the organisation have with the people.

Now lets further explore each one of the above one by one and how Avni models it into the software system.

# 1.  The architecture of the service delivery organisation

Avni allows for modelling of the work geography of the organisation and mapping of service providers to their geographical units. In avni, one can set up the complete geographical area into multiple levels and locations at the same level.

Lets first identify the key domain concepts with their names. A service delivery organisation consists of the following:

* An **organisation** (e.g. NGO, or government department, university), the entity that provides the service or collects some data.
* In order to provide this service or collect data, this organisation employs, hires or engages service providers. They can be called field workers, frontline worker, health worker, etc - we will simply call them **provider or user**.
* The service provided by the organisation via the providers is received by *beneficiaries, citizens, patients, students, children* so on. In the case where the work is data collection, the provider may be additionally or only collecting data for non-living objects like *water body, school, health centre*, etc. Since Avni is a generic platform, let's call of them by a rather imaginative name **subject**.
* In most Avni use cases, the subjects may be spread across a geographical area such that one provider cannot service (or collect data from) all subjects. Hence each provider is assigned a specific area that is called **catchment** in Avni. A catchment could be a block, a cluster of slums, etc.
* Each catchment may have one or more geographical units which are called **location**s in Avni. A location could a village, slum, subcenter area so on.

Each user **must** to be associated with at least one catchment.

![1918](https://files.readme.io/4343bff-Screenshot_2019-11-15_at_5.17.05_PM.png "Screenshot 2019-11-15 at 5.17.05 PM.png")

<Image title="Screenshot 2020-11-16 at 11.50.38 AM.png" alt={2372} src="https://files.readme.io/514028d-Screenshot_2020-11-16_at_11.50.38_AM.png">
  An example of service delivery organisation
</Image>

In Avni system, the organisation, provider, catchment and location are setup via web application by the implementer, IT or program administrator. When a subject is created/registered in the system, they are assigned a location. This is usually done by the field user using their mobile device

# 2.  Modelling the services provided into Avni

Avni allows for modelling of the services provided (or data collected) via a three-level configurable data structure. Avni allows for setting up subjects, enrolment of subjects in programs, and defining encounters for enrolments/subjects. There can be multiple programs per subject type and multiple encounter types per program.

* An organisation may have one or more **subject types** to which they provide service (or collect data for).
* To each subject type, the organisation may be providing one or more service types (or have the purpose of data collection). In Avni, each service type is called a **program**.
* Each service type may involve one or more types of interactions which are called **encounter type**s. Avni also allows one to avoid the service type completely and define encounter types directly for the subject types - allowing for modelling of interactions which are not required to be grouped under services.

![2084](https://files.readme.io/b63d3c9-Screenshot_2019-11-15_at_5.26.15_PM.png "Screenshot 2019-11-15 at 5.26.15 PM.png")

![1942](https://files.readme.io/93a551a-Screenshot_2019-11-15_at_5.27.48_PM.png "Screenshot 2019-11-15 at 5.27.48 PM.png")

![1906](https://files.readme.io/3ca82d4-Screenshot_2020-09-23_at_6.00.45_PM.png "Screenshot 2020-09-23 at 6.00.45 PM.png")

# 3. Groups and relationships

Avni allows for creating groups of subjects and more specifically a special type of group called household or family whereby another subject types (created to represent people) can be members of the household. These members can also be linked to each other via relationships. Do note though that in Avni we have modelled group and households via attributes on subject types. The subjects of such types can be linked as child elements of the parent subject. Please the diagrams below. Avni application behaves differently for groups and households.

<Image title="Screenshot 2020-04-28 at 11.20.04 AM.png" alt={2374} src="https://files.readme.io/a5fd36e-Screenshot_2020-04-28_at_11.20.04_AM.png">
  Group also can behave like subjects also, along with being a group of subjects.
</Image>

<Image title="Screenshot 2020-04-28 at 11.16.09 AM.png" alt={2750} src="https://files.readme.io/740185f-Screenshot_2020-04-28_at_11.16.09_AM.png">
  Household is a special type of group, which has persons as members. The persons can be related to each other via human relationship types.
</Image>

# 4.  Design of a service encounter

Service encounter is an encapsulation of a type of interaction between the service provider and the beneficiary - as explained above. Each service encounter consists of the following:

* observation made by the service provider (field workers)
* answer is given by the beneficiary for a question asked by the provider
* information/suggestion/recommendation made by provider
* computed or preset information provided by the avni app to the provider
* photos/videos taken by the provider

Avni allows you to arrange these sequentially and including based on conditions set by you. It also allows to schedule next service encounters based on a rule set by you. This is modelled using form, rules and content. Each service encounter can be defined in this way.

<Image title="Screenshot 2019-11-15 at 5.30.31 PM.png" alt={2040} src="https://files.readme.io/d7f0b31-Screenshot_2019-11-15_at_5.30.31_PM.png">
  Anatomy of an encounter type (or a subject registration form)
</Image>

<Image title="Screenshot 2019-11-15 at 1.53.16 PM.png" alt={1814} border={true} src="https://files.readme.io/5fdb3eb-Screenshot_2019-11-15_at_1.53.16_PM.png">
  Example of a few form element groups.
</Image>

<Image title="Screenshot 2019-11-15 at 1.55.34 PM.png" alt={2180} border={true} src="https://files.readme.io/2c87d92-Screenshot_2019-11-15_at_1.55.34_PM.png">
  Example of form elements within a form element group.
</Image>

---

## `readme/Implementers/basic-feature-guide/concepts.md`

title: Concepts
excerpt: Learn about the different types of concepts and their nuances
    - type: basic
      slug: rules-concept-guide
      title: Rules concept guide
---
**Concepts** define the different pieces of information that you collect as part of your service delivery.  

For example, if you collect the blood pressure of a subject in a form, then "*Blood Pressure*" should be defined as a concept. You would notice that every question in a form requires a concept.  

The *datatype* of a concept determines the kind of data can be stored against a concept, and therefor against the form question or form element. Using concepts with datatypes ensures incorrect answers are not captured in a form question, and is helpful for eventually data aggregation, validation and reporting.

## Supported DataTypes in Concepts

The following datatypes are supported while defining concepts to be used in forms:

<Table align={["left","left"]}>
  <thead>
    <tr>
      <th>
        Concept DataType
      </th>

      <th>
        Description
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        * Numeric\_ **concepts** 
      </td>

      <td>
        Numeric concepts are used to capture numbers. When creating a numeric concept, you can define normal ranges and absolute ranges. In the field application, if an observation for a concept collected goes beyond the normal range, then it is highlighted in red. Values above the absolute range are not allowed.  For instance for concept: Blood Pressure (Systolic), you can choose a Numeric concept with ranges.
      </td>
    </tr>

    <tr>
      <td>
        **Coded concepts (and NA concepts)** 
      </td>

      <td>
        Coded concepts are those that have a fixed set of answers. For instance for Blood Group you would choose a coded concept with values: A+, B+, AB+, etc.  

        These answers are also defined as concepts of NA datatype.
      </td>
    </tr>

    <tr>
      <td>
        **ID datatype** 
      </td>

      <td>
        A concept of Id datatype is used to store autogenerated ids. See [Creating identifiers](doc:creating-identifiers) for more information on creating autogenerated ids.  For instance PatientIDs, TestIDs, etc.
      </td>
    </tr>

    <tr>
      <td>
        **Media concepts (Image, Video and Audio)**
      </td>

      <td>
        Images and videos can be captured using Image and Video concept datatypes. For audio recording, Audio datatype can be used.
      </td>
    </tr>

    <tr>
      <td>
        **Text (and Notes) concepts** 
      </td>

      <td>
        The *Text* data type helps capture one-line text while the *Notes* datatype is used to capture longer **form** text.
      </td>
    </tr>

    <tr>
      <td>
        **Date and time concepts**
      </td>

      <td>
        There are different datatypes that can be used to capture date and time.  

        * \*Date\*\* - A simple date with no time  
        * \*Time\*\* - Just the time of day, with no date  
        * \*DateTime\*\* - To store both date and time in a single observation  
        * \*Duration\*\* - To capture durations such as 4 weeks, 2 days etc.
      </td>
    </tr>

    <tr>
      <td>
        **Location concepts**
      </td>

      <td>
        * Location\_ concepts can be used to capture locations based on the location types configured in your implementation.  

        Location concepts have 3 attributes:  

        1. Within Catchment - Denotes whether the location to be captured would be within the catchment already assigned to your field workers. This attribute defaults to true and is mandatory.

        2. Lowest Level(s) - Denotes the lowest location type(s) you intend to capture via form elements using this concept. This attribute is mandatory.

        3. Highest Level - Denotes the highest location type that you would like to capture via form elements using this concept. This attribute is optional.
      </td>
    </tr>

    <tr>
      <td>
        **Subject concepts**
      </td>

      <td>
        * Subject\_ concepts can be used to link to other subjects.  

        Each Subject concept can map to a single subject type.  

        Any form element using this concept can capture one or multiple subjects of the specified subject type.
      </td>
    </tr>

    <tr>
      <td>
        **Phone Number concepts**
      </td>

      <td>
        For capturing the phone number. It comes with a 10 digit validation. OTP verification can be enabled by turning on the "Switch on Verification" option. Avni uses msg91 for OTP messages, so msg91 `Auth key` and `Template` need to be step up using the admin app.
      </td>
    </tr>

    <tr>
      <td>
        **Group Affiliation concepts** 
      </td>

      <td>
        Whenever automatic addition of a subject to a group is required  Group Affiliation concept can be used. It provides the list of all the group subjects in the form and choosing any group will add that subject to that group when the form is saved.
      </td>
    </tr>

    <tr>
      <td>
        **Encounter** 
      </td>

      <td>
        * Encounter\_ concepts can be used to link an encounter to any form.  

        Each Encounter concept can map to a single encounter type.  It should also provide the scope to search that encounter. Also, name identifiers can be constructed by specifying the concepts used in the encounter form.  

        Any form element using this concept can capture one or multiple encounters of the specified encounter type.
      </td>
    </tr>
  </tbody>
</Table>

<br />

## Showing counselling points in Forms

For showing counselling points in a form, always create a Form Element, using below coded Concept:

* Concept UUID: b4e5a662-97bf-4846-b9b7-9baeab4d89c4
* Concept Name: Placeholder for counselling form element
* Answers: \<None, no answers, to avoid showing them any options>

Specify counselling point as the Form Element Name, add numbering if needed.

Note: **You can reuse the same "Placeholder for counselling form element" multiple times in a single form**, without worrying about uniqueness constraint breach concerns.

---

## `readme/Implementers/basic-feature-guide/draft-simplification-of-reports/avni-metabase-reporting-standards-best-practices.md`

title: 'Avni Metabase Reporting : Standards & Best Practices'
excerpt: >-

#### **Three-Tier Dashboard Layout:**

```
Row 1: Summary & Description
├── Dashboard title and purpose description
├── Explanation of Filters available
└── Key metrics overview

Row 2: Total Count Cards  
├── Aggregate metrics from base query
└── Apply Conditional filters only where appropriate

Row 3+: Filtered Linelists
├── Detailed records for each count card
└── Conditional filters applied
```

#### **Implementation Guidelines:**

* **Base Query Foundation**: All dashboard elements derive from a single, well-defined base query
* **Hierarchical Information Flow**: Summary → Aggregates → Details
* **Consistent Filtering**: Apply same filter logic across all dashboard components
* **User Journey**: Enable logical progression from high-level insights to detailed records

### **2. Dashboard Purity Principle**

#### **Primary Table Focus:**

* **Single Source of Truth**: Each dashboard should have one primary table as its foundation
* **Controlled Joins**: Join additional tables only for supplementary information, not core metrics
* **Avoid Data Mixing**: Don't combine unrelated data sources in a single dashboard

#### **When to Split Dashboards:**

```
❌ Bad: Combined Dashboard
- Subject registrations + Program enrollments + Encounter data
- Multiple unrelated KPIs in one view
- Mixed time periods and contexts

✅ Good: Separate Dashboards  
- Subject Registration Dashboard (primary: beneficiary table)
- Program Performance Dashboard (primary: beneficiary_pregnancy table)
- Service Delivery Dashboard (primary: beneficiary_pregnancy_anc tables)
```

#### **Benefits of Pure Dashboards:**

* **Performance**: Faster query execution
* **Maintainability**: Easier to debug and modify
* **User Experience**: Clear, focused insights
* **Data Integrity**: Reduced risk of incorrect joins

### **3. Complex Query Management via PostETLSync**

#### **PostETLSync Overview**

PostETLSync enables custom data transformations after standard ETL completion through configurable SQL transformations. This feature supports incremental processing, ordered execution, and organization-specific configurations while ensuring data integrity through transaction management.

#### **When to Use PostETLSync:**

* **Views Persisted Across ETL Schema Recreates**: Maintain custom views and derived tables that survive ETL schema rebuilds
* **Derived Tables**: Create complex aggregated views from multiple source tables
* **Custom Business Logic**: Implement organization-specific calculations and transformations
* **Performance Optimization**: Pre-compute complex queries for faster dashboard loading
* **Incremental Updates**: Process only changed data since last sync using timestamp filtering

#### **Configuration Structure:**

PostETLSync uses JSON configuration files (`post-etl-sync-processing-config.json`) with two main sections:

* **DDL Operations**: Create tables, indexes, and database objects (executed first)
* **DML Operations**: Insert and update data with ordered execution and parameter substitution

#### **Key Features:**

* **Automatic Parameter Substitution**: `:previousCutoffDateTime` and `:newCutoffDateTime` for incremental processing
* **Schema-Qualified Operations**: All table references must include schema names for proper permissions
* **Timestamp Filtering**: Built-in support for processing only modified records
* **Transaction Safety**: Ensures data consistency during transformation processes

#### **Best Practices:**

* Always use both timestamp parameters in data modification queries
* Include `is_voided = false` checks when applicable
* Use descriptive prefixes for SQL script naming
* Apply timestamp filters to all subqueries and CTEs
* Begin DDL scripts with appropriate role setting for permissions

This approach transforms complex reporting requirements into maintainable, performant solutions that integrate seamlessly with Avni's ETL pipeline while providing the flexibility needed for organization-specific reporting needs.

### **4. Implementation Best Practices**

#### **Base Query Design:**

```sql
-- Standard base query structure
SELECT 
    -- Primary identifiers
    subject.uuid,
    subject.first_name,
    subject.last_name,
    
    -- Core metrics
    program.name as program_name,
    enrolment.enrolment_date_time,
    
    -- Derived fields for filtering
    CASE WHEN enrolment.program_exit_date_time IS NULL 
         THEN 'Active' ELSE 'Exited' END as enrollment_status,
    
    -- Location hierarchy for geographic filtering
    village.title as village,
    block.title as block,
    district.title as district

FROM beneficiary subject
JOIN beneficiary_pregnancy enrolment ON subject.id = enrolment.individual_id
JOIN program ON enrolment.program_id = program.id
-- Add location joins as needed
WHERE subject.is_voided = false 
  AND enrolment.is_voided = false
```

#### **Dashboard Card Organization:**

1. **Summary Card**: Dashboard description and key insights
2. **Count Cards**: Total enrollments, active cases, completed visits
3. **Linelist Cards**: Detailed records filtered by each count metric

#### **Filter Strategy:**

* **Consistent Parameters**: Same date ranges, locations, programs across all cards
* **Cascading Filters**: Location hierarchy (State → District → Block → Village)
* **User-Friendly Defaults**: Reasonable default values for common use cases

### **5. Quality Assurance Guidelines**

#### **Dashboard Review Checklist:**

* [ ] Single primary table identified
* [ ] All cards use same base query logic
* [ ] Filters work consistently across all cards
* [ ] Performance acceptable (\< 30 seconds load time)
* [ ] Data accuracy verified against source systems
* [ ] User permissions properly configured

#### **Documentation Requirements:**

* Dashboard purpose and target audience
* Base query explanation and assumptions
* Filter definitions and expected behaviors

### **6. Reference Implementation**

Following the <Anchor label="Avni reporting simplification guidelines" target="_blank" href="https://avni.readme.io/docs/draft-simplification-of-reports">Avni reporting simplification guidelines</Anchor>, these principles ensure:

* **Scalable Architecture**: Reports that perform well as data grows
* **Maintainable Codebase**: Clear separation of concerns
* **User-Centric Design**: Intuitive navigation from summary to detail
* **Data Governance**: Consistent metrics across the organization

This structured approach transforms complex organisational data into actionable insights while maintaining system performance and user experience quality.

---

## `readme/Implementers/basic-feature-guide/encounter-type.md`

title: Encounter types
excerpt: ''
    - type: basic
      slug: concepts
      title: Concepts
---
Encounter Types (also called Visit Types) are used to determine the kinds of encounters/visits that can be performed. An encounter can be scheduled for a specific encounter type using rules. Here, we define that encounter type and the forms associated with the encounter type.

An encounter type is either associated directly with a Subject type or is associated with a Program type, which in-turn would be associated with a subject type. It need not always be associated with programs (you can perform an annual survey of a population using encounter types not associated with programs, and use this information to enrol subjects into a program).

## Immutable encounter type

The encounter type can be made immutable by switching on the immutable flag on the encounter type create/edit screen. If the encounter type is marked as immutable then data from the last encounter is copied to the next encounter. Since the encounter is immutable, the edit is not allowed on these encounters.

---

## `readme/Implementers/basic-feature-guide/internal-details-of-avni-sync.md`

title: Sync internals
excerpt: ''
Synchronization (sync) of data from the Avni server to the client is a complex procedure. This document tries to explain it in detail. 

Note that this is an advanced topic that can be skipped for those who are not very familiar with Avni. 

### The primary assumptions related to data collection in Avni

A single User effects a change in data stored on the server for a particular Individual at any given point of time. After this all clients subscribing to that Individual's data are supposed to fetch the latest information from the server and only then perform any other actions related to that Individual. This is implemented through means of providing Idempotent POST Apis for all major entity types in Avni.

This is done, so that, there are no concurrent conflicting changes applied for the same Individual by different users, which would results in indeterminate state for the Individual's data.

### The different objectives of sync

During sync, the primary objective is to push all local changes to the server, and fetch all changes from the server to the device. However, there are a few other side-effects that take place during the sync. 

* #### Handling of change of permissions

When there is a change in the permissions of a user, new entities may need to be synced, or existing entities may need to be deleted from the device. This is handled on the fly during the sync. 

* #### Migration of beneficiaries

Sometimes beneficiaries are migrated from one catchment to another. To handle this, we might either have to retrieve all records of a beneficiary that moved in, or remove all records of a beneficiary that moved out. This is handled through a subject\_migration sync mechanism

**It is highly recommended that any correction to an Individual or its related entities "SyncConcept observations" be made using Individual (POST/PUT/PATCH) External API calls**, so that we perform a holistic update of the Individual and all its related entities( Enrolments, Encounters, Program-encounters, Checklists, EntityApprovalStatus, IndividualRelationships, etc..). We would also be creating the SubjectMigration entities, which are essential in removing the beneficiary records from Users who should no longer have the entity.

* #### Reset of sync

If the catchment of a beneficiary changes (either via change of a user's catchment, or a change in the catchment itself), the existing database becomes invalid and needs a complete resync to ensure the right beneficiaries are present. This is called a sync reset. 

There are partial resets that happen due to change of sync attributes of a particular subject type. This is also handled through smaller sync resets. 

* #### Fast sync

When a user is syncing for the first time, some implementations create an existing Realm database for that catchment that has been synced upto a certain point. The app downloads this pre-created database and syncs everything since that point. This is useful when there are multiple users sharing a catchment, or when a user wants to login from another device. 

### Sync specific data storage

Each app maintains its status of sync through three tables - EntityQueue (for push), EntitySyncStatus (for pull) and SyncTelemetry (for telemetry). 

* #### EntityQueue

There are actually 2 tables that are maintained in Avni for entities that have been either created or changed. These are 

* EntityQueue
* MediaQueue

Before syncing media, observations are stored with the name of the media file. During sync, it is assumed that internet is present. 

During this time, the sync service does the following

1. For each of the media queue items:
   1. It pushes the media to S3 and
   2. On Success, replaces the corresponding observation with the S3 url
   3. Otherwise, for failures, it creates a "Media '$\{Entity}' Error" entry in the EntitySyncStatus, to highlight issues during upload of Media content. These entries get cleaned up only when those exact Media content get synced successfully to the server. If in-case the media gets deleted from the device or did not exist even before the first sync attempt, then those "Media '$\{Entity}' Error" entries remain as is till User does a fresh sync 
2. Only if all Media are uploaded successfully, do the modified Avni entities (with observations having the S3 url) get pushed to the server

At the end of sync, a sync telemetry entries are pushed to the server. 

* #### EntitySyncStatus

The EntitySyncStatus table keeps a pointer of each kind of entity to be synced and the last time it was synced. This helps the sync process to start from where it left off last time. Rows will contain the entity type (Subject, Encounter etc), the specific entity type (Individual, Household, ANC etc. essentially the subject type, program or encounter type) and the last sync time. 

The server api provides a paginated service to pull from the last sync time. The table is updated on each page synced. 

* #### EntityMetadata

This is maintained in code, and provides the following for each kind of entity

* Name of the entity
* url to fetch the entity from the server
* Type of entity - entity can be divided into metadata and transactional data
* Order of sync - The sync is dependent on a specific order. Subjects need to be synced before program encounters etc. 

Sync uses EntityMetadata in conjunction with EntitySyncStatus (for pull) or EntityQueue (for push) to identify the exact order in which entities need to be synced. 

* #### Sync Telemetry

Sync Telemetry notes down the details of each sync - the kind of sync, start time, end time, number of entities synced, app details etc and pushes it to the server for analysis. 

### Detailed sync steps

The sync process can be broadly divided into two activities

1. Data Server sync
2. Media sync\
   In the Data Server sync, all data except media is synced to the server. This is a 2-way sync\
   In the Media sync, media observations are taken from the MediaQueue and uploaded. Observations are modified to match the new S3 urls. 

In our current sync process, if there is media, we do a media sync first and then a data server sync. If there is no media, then we do a single data server sync. 

Once the data server sync and media sync is complete, sync telemetry is uploaded to the server. 

#### Data Server Sync

Here are the steps for a data server sync

1. Retrieve /syncDetails. This sends the existing EntityMetadata to the server to identify all the entities that have changed since the last sync. Only relevant entities are then synced to the client. 
2. Upload all entities marked in the EntityQueue
3. Verify if a data reset is required. If it is, then perform necessary resets
4. Get all reference data
5. Update database to account for new privileges if any (privileges are part of reference data)
6. Get all transactional data
7. Perform any migrations necessary (migration data is part of transactional data. New subjects are downloaded in one-shot with all transactions of a subject retrieved using the /subject/$\{subjectUUID}/allEntities endpoint)
8. Download images linked to news broadcasts
9. Download extensions if any
10. Download icon images of subject types

#### Media server sync

Media content are taken from the MediaQueue and uploaded to S3. Once this is done, these observations are modified to have the S3 url as part of the observation instead of the local file name. The next data server sync syncs these new entities back to the server. 

### Automated sync

Since release 3.36, there is now an automated sync mechanism. With this, entities are synced automatically on a timed basis. This happens once every hour, only if a sync was not run within the last half an hour. Normally, this only includes uploading entities that have been changed on the client. If it has been more than 12 hours since we have had a full sync, then the app does a full sync instead. From release 4.0.0, automated sync can be disabled from user settings in both field app and  webapp.

### Sync from a server's perspective

#### Sync strategy

While the app does not worry too much about the data that is being downloaded, the server ensures that only the right data is being sent to the app. Each subject is synced to the app of a user based on a few conditions

1. If the catchment of the subject matches the catchment of the user
2. If the sync attributes on the registration form of the subject matches the sync attributes of a user
3. If the subject is assigned to the user

The exact sync strategy is defined in a subject type. 

You can read more about the different Sync strategies supported in Avni [here](https://avni.readme.io/docs/sync-strategies).

#### Other tidbits

All transactional data except entity approval status is synced based on catchment. From release 3.38, entity approval status is also synced based on catchment. All reference data except locations is completely synced to the app. Locations are filtered by catchment of the user. 

The /syncDetails call is used to ensure that only relevant entities are requested by the app for a sync. This greatly reduces the number of calls on unchanged entities (there could be about 100 different entities present for an implementation, and only about less than 10 change frequently). 

Only data that has been in the server for more than 10 seconds from the time of the start of sync is provided to the app. This is to prevent in-process transactions from being missed out, and ensures that partial transactions that happen during the sync do not cause any errors

---

## `readme/Implementers/basic-feature-guide/key-system-and-data-flows.md`

title: Key system and data flows concepts
excerpt: ''
    - type: basic
      slug: subject-types
      title: Subject types
---
Now that we understand the [three key components of fieldwork](doc:avnis-domain-model-of-field-based-work) i.e. Organisation, Services and Service Encounter - let's try to understand how Avni works and achieves various functions.

# How implementation-specific mobile application is created?

Avni is a generic platform that allows any organisation doing field-based work to use it for their specific purpose. The diagram below explains the steps involved in creating an organisation-specific application from a generic platform.

<Image title="Screenshot 2019-11-15 at 5.33.27 PM.png" alt={1440} align="center" src="https://files.readme.io/8932d2e-Screenshot_2019-11-15_at_5.33.27_PM.png">
  Data flow of organisation, services and service encounter definition.
</Image>

# How does avni field user gets all the subject data on his/her device?

As we saw earlier, given the organisation work physically consists of catchments and locations. The subjects are living or located at these locations.

<Image title="Screenshot 2019-11-15 at 5.35.21 PM.png" alt={1726} align="center" src="https://files.readme.io/0f59c92-Screenshot_2019-11-15_at_5.35.21_PM.png">
  During organisation setup the implementer or customer IT person sets up catchments with locations and assigns them to the provider (field user)
</Image>

The diagram below shows how the subjects and the subjects's complete data, which is required by the field user (and only those subjects) are made available.

<Image title="Screenshot 2019-11-15 at 6.07.48 PM.png" alt={1580} align="center" src="https://files.readme.io/8e8be68-Screenshot_2019-11-15_at_6.07.48_PM.png">
  Subjects belonging to the catchment of the user downloaded to their device
</Image>

# How Avni works in an offline mode

Avni maintains a database on the mobile device. All the data downloaded from the server is kept on this device. When the user is using the application, all the data is served from this device to the user and all the new data created by the user is stored in the mobile database. When the synchronisation happens this new data is sent to the server.

# How does the generic avni mobile application behave as if it has been developed for a specific organisation?

The diagram below explains how avni app customises itself based on the complete organisational setup (explained earlier).

<Image title="Screenshot 2019-11-15 at 5.52.34 PM.png" alt={1792} align="center" src="https://files.readme.io/8033619-Screenshot_2019-11-15_at_5.52.34_PM.png">
  Avni app customises itself based on the organisation data setup present in the mobile database on the device
</Image>

---

## `readme/Implementers/basic-feature-guide/performance-expectations.md`

title: Performance expectations
excerpt: ''
In the table below different performance items have been listed with the rough expectations of how long they should take. If during your testing you see response times not inline with the following table, please get it verified by the platform team or technical leads in your team, if indeed the response time is OK.

### Implementation

<Table align={["left","left","left"]}>
  <thead>
    <tr>
      <th style={{ textAlign: "left" }}>
        Performance Item
      </th>

      <th style={{ textAlign: "left" }}>
        General Expectation
      </th>

      <th style={{ textAlign: "left" }}>
        Raise red flag
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td style={{ textAlign: "left" }}>
        **SuperSet/Metabase Dashboard**
        (with or without filters)
      </td>

      <td style={{ textAlign: "left" }}>
        \< 10 seconds
      </td>

      <td style={{ textAlign: "left" }}>
        > 20 seconds
      </td>
    </tr>

    <tr>
      <td style={{ textAlign: "left" }}>
        **SuperSet/Metabase Line list download**
      </td>

      <td style={{ textAlign: "left" }}>
        \< 60 seconds
      </td>

      <td style={{ textAlign: "left" }}>
        > 3 minutes
      </td>
    </tr>

    <tr>
      <td style={{ textAlign: "left" }}>
        **Offline mobile dashboard**\
        (with or without filter values,\
        for any catchment size; on any device)
      </td>

      <td style={{ textAlign: "left" }}>
        \<= 2 seconds
      </td>

      <td style={{ textAlign: "left" }}>
        > 5 seconds
      </td>
    </tr>

    <tr>
      <td style={{ textAlign: "left" }}>
        * \*Summary and Recommendations\
          Screen\*\* (mobile app; on any device)
      </td>

      <td style={{ textAlign: "left" }}>
        \<= 2 seconds
      </td>

      <td style={{ textAlign: "left" }}>
        > 5 seconds
      </td>
    </tr>
  </tbody>
</Table>

### Platform

These are platform issues, but may have been caused by some specific configuration of the organisation, hence may not be a known issue. So please feel free to report them.

<Table align={["left","left","left"]}>
  <thead>
    <tr>
      <th>
        Performance Item
      </th>

      <th>
        General Expectation
      </th>

      <th>
        Raise red flag
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        **Incremental sync**
        (on wifi network; on any device)
      </td>

      <td>
        \< 20 seconds
      </td>

      <td>
        > 1 minute
      </td>
    </tr>

    <tr>
      <td>
        * \*Subject search\*\* (mobile app; on any device)
      </td>

      <td>
        \<= 3 seconds
      </td>

      <td>
        > 5 seconds
      </td>
    </tr>

    <tr>
      <td>
        * \*DEA subject search\*\* (after release 10)\
          with/without filters
      </td>

      <td>
        \<= 5 seconds
      </td>

      <td>
        > 10 seconds
      </td>
    </tr>

    <tr>
      <td>
        **All admin / app designer screens**\
        (Except CSV, bundle uploads)
      </td>

      <td>
        \<= 5 seconds
      </td>

      <td>
        > 10 seconds
      </td>
    </tr>
  </tbody>
</Table>

---

## `readme/Implementers/basic-feature-guide/rules-concept-guide.md`

title: Rules concept guide
excerpt: ''
Avni uses rules, or more accurately snippets of code (functions are written in JavaScript) in multiple places to provide flexibility to the implementers/developers to customise what Avni can do for the users. One can think of the rule system of Avni as a set of hooks that can be used by the rule authors to plug their own data/behaviour/logic to the app when it is used in the field and in the data entry application.

The rules are simple JavaScript functions that receive all the data via function parameters and they should return to the platform what it wants to get done. There is no state that needs to be maintained by JavaScript functions across invocations.

## Why are rules needed in Avni?

Since Avni is a general-purpose platform it doesn't know certain details about your problem domain. Wherever Avni doesn't know this - it leaves a hook for the implementer to provide the missing functionality.

## Overview of various rules

Complete programmatic reference is provided in the [Writing rules](doc:writing-rules), the following diagram explains how most of the rules are used. It displays navigation between the different screens and shows the rules that are triggered in the yellow boxes.

<Image align="center" className="border" width="80%" border={true} src="https://files.readme.io/37b4a00-Screenshot_2024-02-21_at_8.51.57_PM.png" />

In most rules, the rule has access to all the data of the subject and any data that is logically linked to the subject. e.g. In an encounter form level rule, one can access its subject form data, subject's relatives data, subject's relatives encounter data and so on.

#### Validation Rule

Validate the entire form. Last page of the form wizard. One per form.

#### Decision Rule

Add additional system generated observations. Last page of the form wizard. One per form.

#### Visit (Encounter) Schedule Rule

Create scheduled encounters with only due dates and no data.

#### Worklist Updation Rule

To display next forms on completion of one form.

#### Subject/Enrolment Summary

Display chosen information to summarise subject/enrolment on Subject dashboard screen.

#### Encounter/Enrolment Eligibility Check Rule

Before displaying list of forms that the user can fill check and filter out forms.

#### Manual Enrolment Eligibility Check Rule

If this rule is present, a custom form is shown to the user when the user starts enrolment. Based on the data filled and other subject data the rule decides which programs to display.

#### Edit Form Rule

If defined it can disallow editing of any form based on the rule. This rule is applied after access control is checked. This is available for: Registration, Enrolment, Enrolment Exit, Program Encounter, Program Encounter Cancel, General Encounter, General Encounter Cancel, Group Subject Registration, Form Element Group Edit and Checklist Item. It is not available/applicable for:

* Location
* Task (as there is no edit screen for it)
* SubjectEnrolmentEligibility, ManualProgramEnrolmentEligibility (these are unused features as of now)
* Encounter Drafts, Scheduled Encounters - should always be editable/fillable unless controlled by access control.

---

## `readme/Implementers/basic-feature-guide/setting-up-your-data-model.md`

title: Setting up your data model
excerpt: ''
    - type: basic
      slug: my-dashboard-and-search-filters
      title: My Dashboard and Search Filters
---
As explained in [Implementer's concept guide - Introduction](doc:implementers-concept-guide-introduction) - subject, program and encounter are the three key building blocks you have - using which you can model almost all field-based work. Groups (households) that are a special type of subject will be treated as the fourth building block.

In the web application, you would see three menus which map to above - subject types, programs and encounter types. You must be assigned an organisation admin role to be able to do this. If you are, then you can see these options under the Admin section. Each one of the following is linked to their respective forms which you can navigate from the user interface.

![](https://files.readme.io/f4090d7-Screenshot_2020-04-28_at_11.30.58_AM.png "Screenshot 2020-04-28 at 11.30.58 AM.png")

When setting up your model you will be defining the concepts and forms. The diagram below explains the relationship between entities above, form and concepts. Currently, in the application, you may need to go to the concept's view to edit it fully. Soon we would provide seamless editability of the underlying concept via form editing.

![](https://files.readme.io/f678cdd-Screenshot_2020-04-28_at_6.44.23_PM.png "Screenshot 2020-04-28 at 6.44.23 PM.png")

An example form below of name "Child Enrolment", with one form element group called "Child Enrolment Basic Details". This form element group has 6 form elements.

![](https://files.readme.io/eb3a4bf-Screenshot_2020-04-28_at_7.13.21_PM.png "Screenshot 2020-04-28 at 7.13.21 PM.png")

One of the form element is displayed below with all the details. The concept used by the form element is also displayed like allow data range values. From this screen, as of now, it is not editable you need to go to the concepts tab to edit it.

![](https://files.readme.io/f968766-Screenshot_2020-04-28_at_7.17.04_PM.png "Screenshot 2020-04-28 at 7.17.04 PM.png")

You can specify the skip logic for under the rule tab within the form element. This currently is done only using JavaScript, but in future, one would be able to do it using the UI directly. For more on rules please see the [Writing rules](doc:writing-rules).

![](https://files.readme.io/661ab7b-Screenshot_2020-05-19_at_4.49.43_PM.png "Screenshot 2020-05-19 at 4.49.43 PM.png")

---

## `readme/Implementers/basic-feature-guide/subject-types.md`

title: Subject types
excerpt: ''
    - type: basic
      slug: encounter-type
      title: Encounter types
---
Subject Types define the subjects that you collect information on. Eg: Individual, Tractor, Water source, Classroom session. Service Providers in an organisation could be 

* taking action "Against" or "For" beneficiaries, citizens, patients, students, children, etc.
* collecting data for non-living objects like Water-body, School, Health Centre, etc.

## Different types of Subject in Avni

Avni allows for creating multiple Subject Types, each of which can be of any one of the following kind: 

* **Group** - Used for representing an entity which constitutes a group of another subject type. Ex: A group of Interns enrolled for a specific Program for the Year 2023
* **Household** - Special kind of Group, which usually refers to a Household of beneficiaries living in a single postal address location. Ex: A household consisting of a family of Father, Mother and children. Additionally, has a feature to assign one of the members as Head of the Household.
* **Individual** - Generic type of Subject to represent a Place, Person, Thing, Action. etc.. Ex: School, Student, Pocelain Machine, Distribution of Materials, etc.
* **Person** - Special kind of Individual, to specifically indicate a Human Being. Additionally has in-built capability to save First and Last Names, Gender and Date of Birth.
* **User** - A type of Subject used to provide self-refer to the Service Providers in Avni. Read more about [User Subject Types](doc:user-subject-types)

---

## `readme/Implementers/basic-feature-guide/sync-strategies.md`

title: Sync strategies
excerpt: ''
Sync strategies define the way a subject should sync to the user's device. Sync strategies can be defined for each subject type. Each subject type can have different/same sync strategies based on the use case.\
Setting up a sync strategy is a two-step process.

* Defining sync strategy for a subject type.
* Assigning the value of the defined strategy to the user.

## Defining sync strategy for a subject type

For defining sync strategy edit the subject type and under the advance settings configure the sync settings. Below are the different sync strategies available.

| Sync strategy               | Description                                                                                                                                                     |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync by location            | This is the default strategy and the subject is synced by their registered location.                                                                            |
| Sync by direct assignment   | When this is enabled only subjects assigned to the user will get synced to the user's device.                                                                   |
| Sync registration concept 1 | Any mandatory form element's concept from the registration form can be selected. Subjects get synced based on the values assigned to the user for this concept. |
| Sync registration concept 2 | Similar to `Sync registration concept 1`, this is to support once more concept for the same subject type.                                                       |

![](https://files.readme.io/ad013a1-sync-settings.png "sync-settings.png")

## Assigning the value of the defined strategy to the user

Once the sync strategy is defined for a subject type, values can be assigned to the user so that only those values get synced to the user's device. This can be done by editing an existing user or while creating a new user.

| Sync strategy               | Supported values                   |
| :-------------------------- | :--------------------------------- |
| Sync by location            | Catchment                          |
| Sync by direct assignment   | Already registered subjects        |
| Sync registration concept 1 | Concept values (Code/Text/Numeric) |
| Sync registration concept 2 | Concept values (Code/Text/Numeric) |

![](https://files.readme.io/f215814-Sync_settings.png "Sync settings.png")

**Note** 

* In case of any catchment changes/direct assignment changes user needs to delete the old data and sync as per the newly assigned values.

## Handling on Data Entry App (DEA)

Starting August 2024 ([v9.3.0](https://github.com/avniproject/avni-product/releases/tag/v9.3.0)), sync strategy is also respected for updates made via DEA. DEA users will be able to search for and view all data but will be restricted from creating new / updating existing entities that do not match their sync settings.

If the update the DEA user is making involves changing the value of the attribute controlling sync, the user will be blocked from doing so unless the sync setting allows the user access to both the original value as well as the changed value. i.e. if the DEA user is updating the address of a subject from 'Delhi' to 'Mumbai', the catchment for the DEA user needs to contain both 'Delhi' and 'Mumbai' 

### Override to ignore sync registration concepts

A user-level setting is available to ignore the user's sync registration concept settings for updates made via DEA. Location and Assignment strategies will continue to be respected. In the Avni admin app, navigate to Users -> Search for / Select the user to be modified -> Edit -> Toggle the setting 'Ignore below listed sync settings in the Data Entry app'

![](https://files.readme.io/2f475037479d5e87ded6067331bc01566e0a94bac10d7e896d6725043ea1e44f-image.png)

---

## `readme/Implementers/basic-feature-guide/sync.md`

title: Sync Scheduling
excerpt: >-
  description: ''
---
## Sync data between Avni Client and Server

Sync between Avni Client and Server is initiated by the Client and could be of following types:

### Manual Sync(User triggered, upload and fetch data)

> 📘
>
> As part of manual sync, we'll first replace the "background-sync" job with a "dummy sync" job, perform manual-sync and then, replace the "dummy sync" job again with "background-sync" job.\
> In react-native-background-worker, when we schedule a job with same jobKey(Name) as an existing job, it replaces the old one with new one. Therefore, above specified steps are supposed to fulfill our need to NOT run background-sync in parallel with manual-sync.\
> This is done, as we do not have a way to cancel jobs by name directly in react-native-background-worker. We could only cancel by id, but we do not want to store job id in db.\
> ![](https://files.readme.io/2dcc00c-ManualAndDummySync.png)

### Automatic Sync

1. Complete Sync (Both upload and fetch data)
2. Partial Sync (Only upload of data)\
   ![](https://files.readme.io/d567681-Screenshot_2023-10-30_at_12.08.26_PM.png)

---

## `readme/Implementers/basic-feature-guide/writing-rules.md`

title: Writing rules
excerpt: ''
    - type: basic
      slug: access-control
      title: Access Control
---
> 🚧 Important Update on Rules Execution
> 
> Please be informed that all existing rules stored in the rules table will become obsolete by the end of this year, 2024. This means that starting January 1, 2025, these rules will no longer be executed.
> 
> However, any rules added through the App Designer and avni-health-modules will continue to work as expected.
> 
> If you have any questions or need assistance with migrating your rules, please contact our support team.

# Contents:

[Introduction](/docs/writing-rules#introduction)  
[Rule types](/docs/writing-rules#rule-types)  
[Using service methods in the rules](/docs/writing-rules#using-service-methods-in-the-rules)  
[Using other group/household individuals' information in the rules](/docs/writing-rules#using-other-grouphousehold-individuals-information-in-the-rules)  
[Types of rules and their support/availability in Data Entry App](/docs/writing-rules#types-of-rules-and-their-supportavailability-in-data-entry-app)  
[Types of rules and their support/availability in transaction data upload](/docs/writing-rules#types-of-rules-and-their-supportavailability-in-transaction-data-upload)

## Introduction:

Rules are just normal JavaScript functions that take some input and returns something. You can use the full power of JavaScript in these functions. We also provide you with some helper libraries that make it easier to write rules. We will introduce you to these libraries in the examples below.

All rule functions get passed an object as a parameter. The parameter object has two properties: 1. imports 2. params. The imports object is used to pass down common libraries. The params object is used to pass rule-specific parameters. In params object, we pass the relevant entity on which rule is being executed e.g. if a rule is invoked when a program encounter is being performed then we pass the ProgramEncounter object. The entities that we pass are an instance of classes defined in [avni-models](https://github.com/avniproject/avni-models)

### Shape of common imports object:

```javascript
{
  rulesConfig: {}, //It exposes everything exported by rules-config library. https://github.com/avniproject/rules-config/blob/master/rules.js.
  common: {}, // Library we have for common functions https://github.com/avniproject/avni-client/blob/master/packages/openchs-health-modules/health_modules/common.js
  lodash: {}, // lodash library
  moment: {}, // momentjs library
  motherCalculations: {}, //mother program calculations https://github.com/avniproject/avni-health-modules/blob/master/src/health_modules/mother/calculations.js
  log: {} //console.log object
}
```

### Shape of common parameters in all params object

Note there are other elements in params object which are specific to the rule hence have been described below.

```javascript
{    
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects, to which the User is assigned to 
}
```

User: [https://github.com/avniproject/avni-models/blob/master/src/UserInfo.js](https://github.com/avniproject/avni-models/blob/master/src/UserInfo.js)

Group: [https://github.com/avniproject/avni-models/blob/master/src/Groups.js](https://github.com/avniproject/avni-models/blob/master/src/Groups.js)

#### Entities passed to the rule

All rule receives an entity from the `params` object. Depending on the rule type an entity can be one of [Individual](https://github.com/avniproject/avni-models/blob/master/src/Individual.ts), [ProgramEncounter](https://github.com/avniproject/avni-models/blob/master/src/ProgramEncounter.js), [ProgramEnrolment](https://github.com/avniproject/avni-models/blob/master/src/ProgramEnrolment.js), [Encounter](https://github.com/avniproject/avni-models/blob/master/src/Encounter.js), or [ChecklistItem](https://github.com/avniproject/avni-models/blob/master/src/ChecklistItem.js). The shape of the entity object and the supported methods can be viewed from the above links on each entity.

## Rule types

1. [Enrolment summary rule](/docs/writing-rules#1-enrolment-summary-rule)
2. [Form element rule](/docs/writing-rules#2-form-element-rule)
3. [Form element group rule](/docs/writing-rules#3-form-element-group-rule)
4. [Visit schedule rule](/docs/writing-rules#4-visit-schedule-rule)
5. [Decision rule](/docs/writing-rules#5-decision-rule)
6. [Validation rule](/docs/writing-rules#6-validation-rule)
7. [Enrolment eligibility check rule](/docs/writing-rules#7-enrolment-eligibility-check-rule)
8. [Encounter eligibility check rule](/docs/writing-rules#8-encounter-eligibility-check-rule)
9. [Checklists rule](/docs/writing-rules#9-checklists-rule)
10. [Work list updation rule](/docs/writing-rules#10-work-list-updation-rule)
11. [Subject summary rule](/docs/writing-rules#11-subject-summary-rule)
12. [Hyperlink menu item rule](/docs/writing-rules#12-hyperlink-menu-item-rule)
13. [Message rule](https://avni.readme.io/docs/writing-rules#13-message-rule)
14. [Dashboard Card rule](https://avni.readme.io/docs/writing-rules#14-dashboard-card-rule)
15. [Manual Programs Eligibility Check Rule](https://avni.readme.io/docs/writing-rules#15-manual-programs-eligibility-check-rule)
16. [Member Addition Eligibility Check Rule](https://avni.readme.io/docs/writing-rules#16-member-addition-eligibility-check-rule)
17. [Edit Form Rule](https://avni.readme.io/docs/writing-rules#17-edit-form-rule)
18. [Global reusable code rule](https://avni.readme.io/docs/writing-rules#18-global-reusable-code-rule-alpha)

<br />
![Invocation of different rule types](https://files.readme.io/2284f79-Screenshot_2020-07-03_at_9.33.55_AM.png)

<br />
![](https://files.readme.io/baad794-Screenshot_2020-07-03_at_9.59.42_AM.png)

<br/><hr/>

## 1. Enrolment summary rule

- Logical scope = Program Enrolment
- Trigger = Before the opening of a subject dashboard with default program selection. On program change of subject dashboard.
- In designer = Program (Enrolment Summary Rule)
- When to use = Display important information in the subject dashboard for a program

You can use this rule to highlight important information about the program on the Subject Dashboard in table format. It can pull data from all the encounters of enrolment and the enrolment itself. You can use this when the information you want to show is not entered by the user in any of the forms and is also not required for any reporting purposes (hence you wouldn't also generate this data via decision rule).

### Shape of params object:

```javascript
{ 
  summaries: [],
  programEnrolment: {}, // ProgramEnrolment model
	services,
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects  
}
```

You need to return an array of summary objects from this function.

### Shape of the summary object:

```
{
  "name": "name of the summary concept",
  "value": <text> | <number> | <date> | <datetime> | <concept list in case of Coded question>
}
```

### Example:

```
({params, imports}) =>  {
    const summaries = [];
    const programEnrolment = params.programEnrolment;
    const birthWeight = programEnrolment.findObservationInEntireEnrolment('Birth Weight');
    if (birthWeight) {
      summaries.push({name: 'Birth Weight', value: birthWeight.getValue()});
    }
    return summaries;
};
```
![](https://files.readme.io/4f29afe-Screenshot_2020-05-19_at_3.09.44_PM.png)

<br />
![](https://files.readme.io/6fdb1f3-4bf85d9-encounter-scheduling-2.png)

<br/><hr/>

## 2. Form element rule

- Logical scope = Form Element
- Trigger = Before display of form element in the form wizard and on any change done by the user in on that page
- In designer = Form Element (RULES tab)
- When to use = 
  - Hide/show a form element
  - auto calculate the value of a form element
  - reset value of a form element

### Shape of params object:

```javascript
{
  entity: {}, //it could be one of Individual, ProgramEncounter, ProgramEnrolment, Encounter and ChecklistItem depending on what type of form is this rule attached to
  formElement: {}, //form element to which this rule is attached to
  questionGroupIndex,
  services,
  entityContext,
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects  
}
```

This function should return an instance of [FormElementStatus](https://github.com/avniproject/avni-models/blob/master/src/application/FormElementStatus.js) to show/hide the element, show validation error, set its value, reset a value, or skip answers.

To reset a value, you can use FormElementStatus.\_resetIfValueIsNull() method.  
You can either use FormElementStatusBuilder or use normal JavaScript to build the return value. FormElementStatusBuilder is a helper class provided by Avni that helps writing rules in a declarative way.

### Examples using FormElementStatusBuilder.

```javascript Registration Form
'use strict';
({params, imports}) => {
  const individual = params.entity;
  const formElement = params.formElement;
  const statusBuilder = new imports.rulesConfig.FormElementStatusBuilder({individual, formElement});
  statusBuilder.show().when.valueInRegistration("Number of hywas required").is.greaterThan(0);
  return statusBuilder.build();
};
```
```javascript Program Enrolment Form 1
({params, imports}) => {
  const programEnrolment = params.entity;
  const formElement = params.formElement;
  const statusBuilder = new imports.rulesConfig.FormElementStatusBuilder({programEnrolment, formElement});
  statusBuilder.show().when.valueInEnrolment('Is child getting registered at Birth').containsAnswerConceptName("No");
  return statusBuilder.build();//this method returns FormElementStatus object with visibility true if the conditions given above matches
};
```
```javascript Program Enrolment Form 2
({params, imports}) => {
    const gravidaBreakup = [
        'Number of miscarriages',
        'Number of abortions',
        'Number of stillbirths',
        'Number of child deaths',
        'Number of living children'
    ];
    const computeGravida = (programEnrolment) => gravidaBreakup
        .map((cn) => programEnrolment.getObservationValue(cn))
        .filter(Number.isFinite)
        .reduce((a, b) => a + b, 1);
    
    const [formElement, programEnrolment] = params.programEnrolment;
    const firstPregnancy = programEnrolment.getObservationReadableValue('Is this your first pregnancy?');
    const value = firstPregnancy === 'Yes' ? 1 : firstPregnancy === 'No' ? computeGravida(programEnrolment) : undefined;
    return new FormElementStatus(formElement.uuid, true, value);
};
```
```javascript Program Encounter Form
'use strict';
({params, imports}) => {
  const programEncounter = params.entity;
  const formElement = params.formElement;
  const statusBuilder = new imports.rulesConfig.FormElementStatusBuilder({programEncounter, formElement});
  const value = programEncounter.findLatestObservationInEntireEnrolment('Have you received first dose of TT');
  statusBuilder.show().whenItem( value.getReadableValue() == 'No').is.truthy;
  return statusBuilder.build();
};
```
```javascript Encounter Form
'use strict';
({params, imports}) => {
  const encounter = params.entity;
  const formElement = params.formElement;
  const statusBuilder = new imports.rulesConfig.FormElementStatusBuilder({encounter, formElement});
  statusBuilder.show().when.valueInEncounter("Are machine start and end hour readings recorded").is.yes;
  return statusBuilder.build();
};
```
```Text AffiliatedGroups
//In-order to fetch affiliatedGroups set as part of GroupAffiliation Concept in the same form,
//one needs to access params.entityContext.affiliatedGroups variable.

// Old Rule snippet
// const phulwariName = _.get(_.find(programEnrolment.individual.affiliatedGroups, ({voided}) => !voided), ['groupSubject', 'firstName'], '');

// New Rule snippet
const phulwariName = _.get(_.find(params.entityContext.affiliatedGroups, ({voided}) => !voided), ['groupSubject', 'firstName'], '');

```
![](https://files.readme.io/ece1355-Screenshot_2020-07-02_at_6.21.43_PM.png)
<br />
![](https://files.readme.io/abb6bcf-4692c21-SkipLogic.gif)

Please note that form element rules are not transitive and cannot depend on the result of another form element's form element rule. The rule logic for a particular element will need to cater to this. 

i.e. If rule C on element C depends on value of element B and rule B depends on value of element A, updating A will only update B's value and not C's value. 

<br/><hr/>

## 3. Form element group rule

- Scope = Form Element Group
- Trigger = Before display of form element group to the user (including previous or next)
- In designer = Form Element Group (RULES tab)
- When to use = Hide/show a form element group

Sometimes we want to hide the entire form element group based on some conditions. This can be done using a form element group (FEG) rule. There is a rules tab on each FEG where this type of rule can be written. Note that this rule gets executed before form element rule so if the form element is hidden by this rule then the _form element rule_ will not get executed.

### Shape of params object:

```javascript
{
  entity: {}, //it could be one of Individual, ProgramEncounter, ProgramEnrolment, Encounter and ChecklistItem depending on what type of form is this rule attached to
  formElementGroup: {}, //form element group to which this rule is attached to
  services,
  entityContext,
  user, //Current User's UserInfo object
  myUserGroups //List of Group objects
}
```

This function should return an array of  [FormElementStatus](https://github.com/avniproject/avni-models/blob/master/src/application/FormElementStatus.js)

### Example:

```
({params, imports}) => {
    const formElementGroup = params.formElementGroup;
    return formElementGroup.formElements.map(({uuid}) => {
        return new imports.rulesConfig.FormElementStatus(uuid, false, null);
    });
};
```

<br/><hr/>

## 4. Visit schedule rule

- Logical scope = Encounter (aka Visit), Subject, or Program Enrolment
- Trigger = On completion of an form wizard before final screen is displayed
- In designer = Form (RULES tab)
- When to use = For scheduling one or more encounters in the future

### Shape of params object:

```javascript
{
  entity: {}, //it could be one of ProgramEncounter, ProgramEnrolment, Encounter depending on what type of form is this rule attached to.
  visitSchedule: []// Array of already scheduled visits.
  entityContext
  services,
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects  
}
```

You need to return an array of visit schedules from this function.

### Shape of the return value

```
[
  <visit schedule object>
  ...
]
```

### visit schedule object

```
{
	name: "visit name", 
	encounterType: "encounter type name", 
	earliestDate: <date>, 
	maxDate: <date>,
	visitCreationStrategy: "Optional. One of default|createNew",
	programEnrolment: "<Optional. Used if you want to create a visit in a different program enrolment. If the program enrolment is tied to another subject, the visit will be schedule for that subject. Do not pass this parameter if you want to schedule a general encounter.>",
	subjectUUID: "<Optional UUID string. Used if you want to create a general visit for another subject.>"
}
```

### Example

```
({ params, imports }) => {
  const programEnrolment = params.entity;
  const scheduleBuilder = new imports.rulesConfig.VisitScheduleBuilder({
    programEnrolment
  });
  scheduleBuilder
    .add({
      name: "First Birth Registration Visit",
      encounterType: "Birth Registration",
      earliestDate: programEnrolment.enrolmentDateTime,
      maxDate: programEnrolment.enrolmentDateTime
    })
    .whenItem(programEnrolment.getEncounters(true).length)
    .equals(0);
  return scheduleBuilder.getAll();
};
```

### Example 2 - Schedule a general visit on a household when a member completes a program enrolment

```
.
.
  scheduleBuilder.add({
      name: "TB Family Screening Form",
      encounterType: "TB Family Screening Form",
      earliestDate: imports.moment(programEnrolment.encounterDateTime).toDate(),
      maxDate: imports.moment(programEnrolment.encounterDateTime).add(15, 'days').toDate(),
      subjectUUID: programEnrolment.individual.groups[0].groupSubject.uuid
  });
.
.
```
![](https://files.readme.io/42b7d6b-Screenshot_2020-05-19_at_7.04.19_PM.png)

<br />
![](https://files.readme.io/cbaef6a-4fff50b-encounter-scheduling-1.png)

### Strategies that Avni uses.

For all the visit schedules that are returned, Avni evaluates how to create a visit. Assume you provide the default visitCreationStrategy (this is the default behaviour). Avni checks if there is already a scheduled visit for the given encounter type. If it is there, then it is updated with the incoming scheduled visit's name and other parameters. This strategy works well in most cases. 

- Remember that the VisitSchedule rule gets called whether you create a visit, or edit it. 
- Remember not to send multiple visit schedule objects for the same encounter type. If you do, the last one will overwrite the previous objects. 

### Using the "createNew" visit strategy

Do this only if you know what you are doing. If you add visitCreationStrategy of "createNew", then a new visit will be created no matter what. 

You need to be careful while using this strategy because, in edit scenarios, we might end up creating the same kind of visits multiple times. 

### Using the VisitScheduleBuilder.getAllUniqueVisits

VisitSchedulBuilder class has a getAllUniqueVisits method that provides some shortcuts to reduce the cruft you might have to do while creating scheduled visits. It mostly does the right thing, so you don't have to worry about its logic. However, if you think it is doing something you didn't intend, then you can replace it with your own implementation. Look up the [code](https://github.com/avniproject/rules-config/blob/master/src/rules/builder/VisitScheduleBuilder.js) for more details. 

<br/><hr/>

## 5. Decision rule

- Logical scope = Encounter (aka Visit), Subject, or Program Enrolment
- Trigger = On completion of an form wizard before final screen is displayed
- In designer = Form (RULES tab)
- When to use = To create any additional observations based on all the data filled by the user in the form

Used to add decisions/recommendations to the form. The decisions are displayed on the last page of the form and are also saved in the form's observations.

### Shape of params object:

```javascript
{
	entity: {}, //it could be ProgramEncounter, ProgramEnrolment or Encounter depending on what type of form is this rule attached to.
 	entityContext,
  services,
  user, //Current User's UserInfo object  
  myUserGroups, //List of Group objects  
  decisions: {
     	"enrolmentDecisions": [],
    	"encounterDecisions": [],
      "registrationDecisions": []
  } // Decisions object on which you need to add decisions. 
}
```

### Shape of decisions parameter:

```javascript
{
  "enrolmentDecisions": [],
  "encounterDecisions": [],
  "registrationDecisions": []
}
```

You need to add `<decision object>` to decisions parameter's appropriate field and return it back.  
Inside the function, you will build decisions using ComplicationsBuilder and push the decisions to the decisions parameter's appropriate field. The return value will be the modified decisions parameter. You can also choose to not use ComplicationsBuilder and directly construct the return value as per the contract shown below:

### Shape of the return value

```
{
  "enrolmentDecisions": [<decision object>, ...],
  "encounterDecisions": [<decision object>, ...],
  "registrationDecisions": [<decision object>, ...]
}
The shape of <decision object>
{
  "name": "name of the decision concept",
  "value": <text> | <number> | <date> | <datetime> | <name of anwer concepts in case of Coded question>
}
```

### Example

```
({params, imports}) => {
    const programEncounter = params.entity;
    const decisions = params.decisions;
    const complicationsBuilder = new imports.rulesConfig.complicationsBuilder({
        programEncounter: programEncounter,
        complicationsConcept: "Birth status"
    });
    complicationsBuilder
        .addComplication("Baby is over weight")
        .when.valueInEncounter("Birth Weight")
        .is.greaterThanOrEqualTo(8);
    complicationsBuilder
        .addComplication("Baby is under weight")
        .when.valueInEncounter("Birth Weight")
        .is.lessThanOrEqualTo(5);
    complicationsBuilder
        .addComplication("Baby is normal")
        .when.valueInEncounter("Birth Weight")
        .is.lessThan(8)
        .and.when.valueInEncounter("Birth Weight")
        .is.greaterThan(5);
    decisions.encounterDecisions.push(complicationsBuilder.getComplications());
    return decisions;
};
```
![](https://files.readme.io/f0f898a-Screenshot_2020-05-19_at_7.09.58_PM.png)

<br />
![](https://files.readme.io/4b488cc-4fff50b-encounter-scheduling-1.png)

<br/><hr/>

## 6. Validation rule

- Logical scope = Encounter (aka Visit), Subject, or Program Enrolment
- Trigger = On completion of an form wizard before final screen is displayed
- In designer = Form (RULES tab)
- When to use = To provide validation error(s) to the user that are not specific to one form element but involved data in multiple form elements.

Used to stop users from filling invalid data

### Shape of params object:

```
{
  entity: {}, //it could be ProgramEncounter, ProgramEnrolment or Encounter depending on what type of form is this rule attached to.
  entityContext,
  services,
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects  
}
```

The return value of this function is an array with validation errors.

### Example:

```
({params, imports}) => {
  const validationResults = [];
  if(programEncounter.getObservationReadableValue('Parity') > programEncounter.getObservationReadableValue('Gravida')) {
    validationResults.push(imports.common.createValidationError('Para Cannot be greater than Gravida'));
  }
  return validationResults;
};
```
![](https://files.readme.io/fb8e5df-Screenshot_2020-05-19_at_7.14.05_PM.png)

<br/><hr/>

## 7. Enrolment Eligibility Check Rule

- Logical scope = Subject
- Trigger = On launch of program list when user enrols a subject into program
- In designer = Program page
- When to use = To restrict the programs which are available for enrolment based on subject's data (e.g. not allowing males to enrol in pregnancy programs)

### Shape of params object:

```
{
  entity: {}//Subject will be passed here.
  program,
  services,
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects  
}
```

### Shape of the return value

The return value of this function should be a boolean.

### Example:

```
({params, imports}) => {
  const individual = params.entity;
  return individual.isFemale() && individual.getAgeInYears() > 5;
};
```

**Notes**: The eligibility check is triggered only when someone tries to create a visit manually. Form stitching rules can override this default behaviour. 
![](https://files.readme.io/bc76050-Screenshot_2020-05-20_at_3.57.52_PM.png)

<br />
![](https://files.readme.io/ba63cb1-cbe944e-Screenshot_2019-11-20_at_6.51.40_PM.png)

<br/><hr/>

## 8. Encounter Eligibility Check Rule

- Logical scope = Subject or Program Enrolment
- Trigger = On launch of new visit (encounter) list
- In designer = Encounter page
- When to use = To restrict the encounters which are available based on subject's full data (e.g. not showing postnatal care form if the delivery form has not been filed yet)

Used to hide some visit types depending on some data. If there existed scheduled encounters for that subject or program enrolment, clicking on an ineligible visit type, will fill up the scheduled encounter. 

### Shape of params object:

```javascript
{
  entity: {}//Subject will be passed here.
  services,
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects  
}
```

### Shape of the return value

The return value of this function should be a boolean.

### Example:

```
({params, imports}) => {
  const individual = params.entity;
  const visitCount = individual.enrolments[0].encounters.filter(e => e.encounterType.uuid === 'a30afe96-cdbb-42d9-bf30-6cf4b07354d1').length;
  let visibility = true;
  if (_.isEqual(visitCount, 1)) visibility = false;
  return visibility;
};
```

**Notes**: The eligibility check is triggered only when someone tries to create a visit manually. Form stitching rules can override this default behaviour. 
![](https://files.readme.io/0d034b9-Screenshot_2020-05-20_at_4.02.24_PM.png)

<br/><hr/>

## 9. Checklists rule

Used to add a checklist to an enrolment

### Shape of params object:

```javascript
{
  entity: {} //ProgramEnrolment
  checklistDetails: [] // Array of ChecklistDetail
  services,
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects  
}
```

### Example

```
({params, imports}) => {
  let vaccination = params.checklistDetails.find(cd => cd.name === 'Vaccination');
  if (vaccination === undefined) return [];
  const vaccinationList = {
    baseDate: params.entity.individual.dateOfBirth,
    detail: {uuid: vaccination.uuid},
    items: vaccination.items.map(vi => ({
      detail: {uuid: vi.uuid}
    }))
  };
  return [vaccinationList];
};
```

<br/><hr/>

## 10. Work List Updation rule

- Logical scope = Subject, Program Enrolment, or Encounters
- Trigger = On display of system recommendation's page in form wizard
- In designer = Main Menu
- When to use = Stitch together multiple forms which can be filled back to back

The System Recommendations screen of Avni can be configured to direct a user to go to the next task to be done. Typically, if a new encounter is scheduled for a person on the same day, then the system automatically prompts the user to perform that encounter.  
This is performed using worklists. A worklist is an array of [work items](https://github.com/avniproject/avni-models/blob/master/src/application/WorkItem.js). 

The WorkListUpdation rule is used to customize this flow. The WorkLists object is passed on to this rule just before showing the System Recommendations screen. Any modification in the worklists is applied immediately to the flow. 

You can add a new WorkItem anywhere after the currentWorkList.currentItem. 

### Shape of params object:

```javascript
{
  worklists: {},
  context: {},
  services,
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects  
}
```

### Example

[https://gist.github.com/hithacker/d0fe89107b974797fbb11ced1feda146](https://gist.github.com/hithacker/d0fe89107b974797fbb11ced1feda146)
![](https://files.readme.io/ef3535d-Screenshot_2020-05-21_at_3.25.33_PM.png)


<br/><hr/>

## 11. Subject summary rule

- Logical scope = Subject registration
- Trigger = Before the opening of the subject dashboard profile tab.
- In designer = Subject (Subject Summary Rule)
- When to use = Display important information in the subject's profile. It can be used to show the summary if there are no programs.

This rule is very similar to the Enrolment summary rule. Except its scope is the Subject's registration.

### Shape of params object:

```
{ 
  individual: {}, // Subject model,
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects  
}
```

You need to return an array of summary objects from this function.

### Shape of the summary object:

```
{
  "name": "name of the summary concept",
  "value": <text> | <number> | <date> | <datetime> | <concept list in case of Coded question>
}
```

### Example:

```
({params, imports}) =>  {
    const summaries = [];
    const individual = params.individual;
    const mobileNumber = individual.findObservation('Mobile Number'); 
    if(mobileNumber) {
      summaries.push({name: 'Mobile Number', value: mobileNumber.getValueWrapper()});
    }
    return summaries;
};
```

<br/><hr/>

## 12. Hyperlink menu item rule

- Logical scope = User
- Trigger = When More navigation is opened in the mobile app
- In designer = Coming very soon...
- When to use = When a dynamic link has to be provided to the user (these links cannot be specific to subjects)

### Shape of params object:

```
{
  user: {}, // User
  moment: {}, // moment. note other parameters are not supported yet,
  token, //Auth-token of the logged-in user
  myUserGroups //List of Group objects  
}
```

User: [https://github.com/avniproject/avni-models/blob/master/src/UserInfo.js](https://github.com/avniproject/avni-models/blob/master/src/UserInfo.js)

You need to return a string that is the full URL that can be opened in a browser.

### Example:

```
({params}) => {return `https://reporting.avniproject.org/public/question/11265388-5909-438e-9d9a-6faaa0c5863f?username=${encodeURIComponent(user.username)}&name=${encodeURIComponent(user.name)}&month=${imports.moment().month() + 1}&year=${imports.moment().year()}`;}
```

<br/><hr/>

## 13. Message rule

- When to use =  To configure sending Glific messages
- Logical scope = User, Subject, General and Program Encounter, Program Enrolment
- Trigger = 
  - For User : Only on creation of an User . 
  - For Subject, General and Program Encounter, Program Enrolment : On every save (create / update)
- In designer = "User Messaging Config", "Subject Type" , "Encounter type" and "Programs" page

Message Rule can be configured only when 'Messaging' is enabled for the organisation. Its configuration constitutes specifying following details:

- **Name** identifier name for the Message Rule
- **Template** Used to indicate the Skeleton of the message with placeholders for parameters
- **Receiver Type** Used to indicate the target audience for the Glific Whatsap message
- **Schedule** date and time configuration should return the time to send the message.
- **Message** content configuration should return the parameters to be filled in the Glific message template selected under 'Select Template' dropdown.

 Any number of message Rules can be configured.

### Example configuration:

Say, 'common_otp' Glific message template is 'Your OTP for `{{1}}` is `{{2}}`. This is valid for `{{3}}`.' If we want to send a OTP message that says 'Your OTP for receiving books is 1458. This is valid for 2 hours.' to a student after 1 day of their registration, then we need to configure for student subject type as shown in the below image (Note the shape of the return objects): 
![](https://files.readme.io/2e3e442-Screenshot_2023-12-27_at_6.15.54_PM.png)

```Text Schedule
'use strict';  
({params, imports}) => ({  
  scheduledDateTime: new Date("2023-01-05T10:10:00.000+05:30")  
});
```
```text Message
'use strict';  
({params, imports}) => {  
  const individual = params.entity;  
  return {  
    parameters: ['Verify user phone number', '0123', '1 day']  
  }  
};
```

### Shape of params object:

```
{
  entity: {}, //it could be one of User, Individual, General Encounter, ProgramEncounter or Program Enrolment depending on the type of form this rule is attached to
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects  
}
```

## 14. Dashboard Card Rule

The shape of dashboard card rule

```javascript
{
  db: "the realm db instance",
  user,
  myUserGroups,
  // ruleInput object can be null
  ruleInput: {
    type: "string. see 14.1 below",
    dataType: "values can be Default or Range",
    subjectType: "SubjectType model object. The subject type of the subjects to query and display to the user",
    groupSubjectTypeFilter: {
      subjectType: "SubjectType. The group subject type to filter by"
    },
    observationBasedFilter: {
      scope: "string. See 14.2 below",
      concept: "Concept. the observation value being referred to by the filter value",
      programs: {
         "UUID of the program": "Program model object"
      },
      encounterTypes: {
         "UUID of the encounter type": "Encounter Type model object"
      }
    },
    // filterValue can be null or empty array when there are no filters chosen by the user
    filterValue: "value chosen by the user. the type of data depends on the type of the filter"
  }
}
```

### Filter Value Shapes

**Address Filter**

```json
{
  "uuid":"924674dc-d32b-4276-b7b5-fb782f5511f2",
  "name":"Kerala",
  "level":4,
  "type":"State",
  "parentUuid":null,
}
```

<br />

14.1) [https://github.com/avniproject/avni-models/blob/8613b53edbf88e9b19150eda9e13da573e2a59ba/src/CustomFilter.js#L2](https://github.com/avniproject/avni-models/blob/8613b53edbf88e9b19150eda9e13da573e2a59ba/src/CustomFilter.js#L2)

14.2) [https://github.com/avniproject/avni-models/blob/8613b53edbf88e9b19150eda9e13da573e2a59ba/src/CustomFilter.js#L30](https://github.com/avniproject/avni-models/blob/8613b53edbf88e9b19150eda9e13da573e2a59ba/src/CustomFilter.js#L30)

<br/><hr/>

### 15. Manual Programs Eligibility Check Rule

This rule is used when the user fills a form based on which the eligibility of given program is determined by this rule.

#### Shape of Input Object

```javascript
params: {
  entity: typeof SubjectProgramEligibility,
  subject: typeof Individual,
  program: typeof Program,
  services,
  user, //Current User's UserInfo object  
  myUserGroups //List of Group objects  
},
imports: {}
```

#### Return

_boolean_

### 16. Member Addition Eligibility Check Rule

This rule is used to determine whether an **existing** member can be added to a group or household. The rule is configured at the subject type level and is executed when a user attempts to add an existing member to a group/household.

- Logical scope = Group/Household and Individual
- Trigger = On attempt to add a member to a group/household
- In designer = Subject Type (Member Addition Eligibility Check Rule)
- When to use = To validate if an **existing** individual can be added as a member to a specific group/household based on custom business rules

#### Shape of Input Object

```javascript
params: {
  member: typeof Individual, // The individual being added as a member
  group: typeof Individual, // The group/household to which the member is being added
  context: Object, // The execution context
  services,
  user, // Current User's UserInfo object  
  myUserGroups // List of Group objects  
},
imports: {}
```

#### Return

This rule should return an object that follows the ActionEligibilityResponse format, with the following structure:

```javascript
// For allowing addition
{
  eligible: {
    value: true
  }
}

// For disallowing addition with a reason
{
  eligible: {
    value: false,
    message: "Reason why the member cannot be added" //Value of message has translation support.
  }
}
```

#### Example

**Use Case:**

While adding members to a "Self-help" group, we need to validate that the person is an adult, in-which case we would come up with the following

**Member Addition Eligibility Check Rule:**

```javascript
"use strict";
({params, imports}) => {
  const member = params.member;
  const group = params.group;
  
  // Example: Only allow adding members who are above 18 years of age
  const age = member.getAgeInYears();//As on current date
  
  if (age < 18) {
    return {
      eligible: {
        value: false,
        message: "Only individuals above 18 years can be added to this group"
      }
    };
  }
  
  return {
    eligible: {
      value: true
    }
  };
};
```

**Reference Screenshot, when Member Addition Eligibility Check Rule fails:**
![](https://files.readme.io/aaa48f09aa4c5bcaebf2d9ae72f19c0777e719bd463b213b43e011796fd8db0a-Screenshot_2025-06-27_at_7.41.28_PM.png)

#### Error Handling

When a Member Addition Eligibility Check rule fails (throws an exception), the error is logged and stored in the RuleFailureTelemetry with the following information:

- source_type: 'MemberAdditionEligibilityCheck'
- source_id: UUID of the subject type
- entity_type: 'Individual'
- entity_id: UUID of the group/household to which a member is being added
- individual_uuid: UUID of the individual being added to the group/household

### 17. Edit Form Rule

This rule is used when the user tries to edit a form. If non-boolean value is returned in the value, or the rule fails, then it would be treated as true and edit will be allowed. To check the places where it is available, not available, & not applicable - [https://avni.readme.io/docs/rules-concept-guide#edit-form-rule](https://avni.readme.io/docs/rules-concept-guide#edit-form-rule).Value of message has translation support.

#### Sample Rule

```
"use strict";
({params, imports}) => {
    const {entity, form, services, entityContext, myUserGroups, userInfo} = params;

    const output = {
      eligible : {
        value: false, //return false to disallow, true to allow;
        message: 'Edit access denied: <Specify reason here>.' //optional
      } 
    }; 

    return output;
};
```

#### Shape of Input Object

```javascript
params: {entity, services, form, myUserGroups,user},
imports: {}
```

#### Shape of return object

```javascript
// Previous format (still supported)
const output = {
  editable : {
    value: true/false,
    messageKey: 'foo'
  }
};

// New format (generic for all rule based access control)
const output = {
  eligible : {
    value: true/false,
    message: 'foo'
  }
};
```

### 18. Global reusable code rule (Alpha)

This rule is intended maintaining reusable JavaScript functions across implementations. While this could also be used within implementation only but that is not the purpose of this. If you want to create reusable JavaScript code within an implementation only, please check with the product management team to get it prioritised.

> 📘 Not supported in Data entry app. Feature available from 11.0 version.

#### Shape of Input Object

```javascript
// Get handle to the reusable function
const globalFunction = imports.globalFn;
// invoke your function, two examples below.
globalFn().hello();
globalFn().sum(1,2);
```

Note that you can define the signature of your new function (like hello, sum). It is not determined by the global function.

#### How to deploy global function (TBD)

1. Use `make deploy-global-rule`.
   1. Provide the origin and token
   2. The token will determine the organisation to which it is deployed. Rerunning it will update the previous rule.
2. Run sync in the mobile app

## Accessing Address Level Properties :

Old Way is to get the address level properties and extract from the json object. In new way, get the address level and access its observation value as per location attribute form.

```Text JavaScript
'use strict';
({params, imports}) => {
  const programEncounter = params.entity;
  const moment = imports.moment;
  const formElement = params.formElement;
  const _ = imports.lodash;
  let visibility = false;
  let value = 'No';
  let answersToSkip = [];
  let validationErrors = [];
  
  const address_level = programEncounter.programEnrolment.individual.lowestAddressLevel;  
  
  const gHighRisk = address_level.getObservationReadableValue("Geographically hard to reach village");

  if(gHighRisk === "Yes"){
      value = 'Yes';
  }

  
  return new imports.rulesConfig.FormElementStatus(formElement.uuid, visibility, value, answersToSkip, validationErrors);
};
```

<br />

## Handling rule-evaluation across Mobile and Web Applications

This section provides guidelines for handling rule-evaluation across Mobile and Web Applications in Avni implementations. It includes practical examples from the Goonj implementation.

### Detecting Web Application Context

To determine if the application is running in a web context, you can check the `titleLineage` property of the lowest address level:

```javascript
const webapp = individual.lowestAddressLevel.titleLineage;
```

This pattern is used to identify if the application is running in a web context and adjust behavior accordingly.

### Handling Webapp-Specific Scenarios

When working with web applications, consider the following:

- Some validations might need to be bypassed in web context
- UI/UX might need adjustments for web vs mobile
- Performance considerations might differ between platforms

#### Basic Pattern

```javascript
function handleWebappContext(individual) {
    const webapp = individual.lowestAddressLevel.titleLineage;
    
    // Apply webapp-specific logic
    if (webapp) {
        // Webapp-specific code here
    } else {
        // Mobile-specific code here
    }
}

try {
    handleWebappContext(individual);
} catch (error) {
    console.error('Error handling webapp context:', error);
}
```

#### Examples

In the Goonj implementation, we encountered an issue where certain validations were failing in the web context but were not applicable to web users.

##### 1. Webapp Detection and Validation Bypass

```javascript
function validateForm(individual, formData) {
    const webapp = individual.lowestAddressLevel.titleLineage;
    const errors = [];
    
    // Skip webapp-specific validations for web users
    if (!webapp) {
        // Mobile-only validations go here
        if (!formData.requiredField) {
            errors.push('This field is required for mobile users');
        }
    }
    
    // Common validations for both web and mobile
    if (!formData.commonField) {
        errors.push('This field is required for all users');
    }
    
    return errors.length ? errors : null;
}
```

##### 2. Location Validation Example

```javascript
function validateLocation(individual, locationData) {
    const webapp = individual.lowestAddressLevel.titleLineage;
    
    // Skip location validation for webapp
    if (webapp) {
        return null;
    }
    
    // Mobile location validation logic
    if (!locationData || !locationData.coordinates) {
        return ['Location is required for mobile users'];
    }
    
    return null;
}
```

<br />

## Accessing audit fields when writing rules

#### When writing rules, you often need to access information about who created or modified entities, and when these actions occurred. Avni provides several audit fields that can be accessed through the entity object in your rules.

Available Audit Fields

  The following audit fields are available :

- createdByUUID
- lastModifiedByUUID
- createdBy
- lastModifiedBy
- filledBy (only for program and general encounters)
- filledByUUID (only for program and general encounters)

```coffeescript JS
//SAMPLE EDIT FORM RULE
  "use strict";
({params, imports}) => {
const {entity} = params;
console.log("params.entity.createdByUUID:", params.entity.createdByUUID);
console.log("params.entity.lastModifiedByUUID:", params.entity.lastModifiedByUUID);

console.log("params.entity.createdBy:", params.entity.createdBy);
console.log("params.entity.lastModifiedBy:", params.entity.lastModifiedBy);

console.log("params.entity.filledBy:", params.entity.filledBy);
console.log("params.entity.filledByUUID:", params.entity.filledByUUID);

return output;
};
```

<br />

## Using params.db object when writing rules

In many of the rules params db object is available to query the offline database directly. The db object is an instance of type [Realm](https://www.mongodb.com/docs/realm-sdks/js/latest/classes/Realm-1.html) on which [objects](https://www.mongodb.com/docs/realm-sdks/js/latest/classes/Realm-1.html#objects) is first method that will get called. This returns [Realm Results](https://www.mongodb.com/docs/realm-sdks/js/latest/classes/Results.html) instance, on which one may further call the [filtered](https://www.mongodb.com/docs/realm-sdks/js/latest/classes/Results.html#filtered) method one or more times each time returning realm results. Realm result a list with each item being of type (model object's schema name) originally passed in objects method.

```coffeescript JS
'use strict';
({params, imports}) => {
  //...
  
  const db = params.db;
  const farmers = db.objects("Individual").filtered(`voided = false AND subjectType.uuid = "73271784-512d-4435-8dc8-0f102b99d682"`);
  console.log('Found farmers with count', farmers && farmers.length > 0 && farmers.length);

  //...
  return new imports.rulesConfig.FormElementStatus(formElement.uuid, visibility, value, answersToSkip, validationErrors);
};
```

<br />

**Realm Query Language Reference** - [https://www.mongodb.com/docs/realm/realm-query-language](https://www.mongodb.com/docs/realm/realm-query-language)

### Difference between filter and filtered

`filtered` method is like running SQL query executed closer or in the database process and hence it orders of magnitude faster than `filter` - which is JavaScript method ran by constructing model object for each item is JS memory and then passing it through the filter function. As much as possible filtered should be used for best performance and user experience.

### Example of filtered

```javascript
({params}) => {
  const db = {params};
  return db.objects("Individual").filtered(`voided = true AND subjectType.name = "Foo"`);
}
```

## Using service methods in the rules

Often, there is the need to get the context of implementation beyond what the models themselves provide. For example, knowing other subjects in the location might be necessary to run a specific rule. For such scenarios, Avni provides querying the DB using the services passed to the rules.

The services object looks like this

```javascript
{
    individualService: '',
}
```

Right now only individual service is injected into all the rules. One method which is implemented right now returns an array of subjects in a particular location. The method looks like the following, it takes address-level object and subject type name as its parameters and returns a list of all the subjects in that location.

```javascript
getSubjectsInLocation(addressLevel, subjectTypeName) {
  const allSubjects = ....;
  return allSubjects;
}
```

Note that this function is not implemented for the data entry app and throws a "method not supported" error for all the rules when run from the data entry app.

### Service methods available are:

- [https://github.com/avniproject/avni-client/blob/master/packages/openchs-android/src/service/facade/IndividualServiceFacade.js](https://github.com/avniproject/avni-client/blob/master/packages/openchs-android/src/service/facade/IndividualServiceFacade.js)
- [https://github.com/avniproject/avni-client/blob/master/packages/openchs-android/src/service/facade/AddressLevelServiceFacade.js](https://github.com/avniproject/avni-client/blob/master/packages/openchs-android/src/service/facade/AddressLevelServiceFacade.js)

### Examples

The view-filter rule is for the subject data type concept that displays all the subjects of type 'Person' in the passed location. 

```
'use strict';
({params, imports}) => {
  const encounter = params.entity;
  const formElement = params.formElement;
  const statusBuilder = new imports.rulesConfig.FormElementStatusBuilder({encounter, formElement});
  const individualService = params.services.individualService;
  const subjects = individualService.getSubjectsInLocation(encounter.individual.lowestAddressLevel, 'Person');
  const uuids = _.map(subjects, ({uuid}) => uuid);
  statusBuilder.showAnswers(...uuids);
  return statusBuilder.build();
};
```

<br />

#### Fetch Subjects by Subject Type with Custom Filtering

For business reasons, you may need to fetch subjects of a specific type with additional filtering criteria.

##### Using IndividualServiceFacade "getSubjects" method

Use IndividualServiceFacade`getSubjects(subjectTypeName, realmFilter)` method to get subjects by type with optional filtering.

##### Method Signature

- subjectTypeName (string): The name of the subject type (e.g., 'Volunteer', 'Patient', 'Household')
- realmFilter (string, optional): Realm query filter string for additional filtering

```js

  const individualService = params.services.individualService;
  const volunteers = individualService.getSubjects('Volunteer');
  console.log('volunteers:', volunteers.length);

  const subjectsWithObservation = individualService.getSubjects(
    'Patient',
    'SUBQUERY(observations, $obs, $obs.concept.uuid == "concept-uuid-here").@count > 0'
  );
  console.log('Patients with specific observation:', subjectsWithObservation.length);

  
```

## Using other group/household individuals' information in the rules

Say, an individual belongs to a group A. Sometimes, there is a need to use data of other individuals in the group A.  For example, to auto-populate caste information in an individual's registration form (say, when navigated to individual's registration form when tried to add a member to group/household A), we might need to know the caste information of other individuals in that group/household. For such scenarios, Avni provides a way to access `group` object from `params.entityContext`.

### Example

The below rule is for the case when an individual's concept named `Caste` needs to be auto-populated based on other member's data in the same group.

```
'use strict';
({params, imports}) => {
  const individual = params.entity;
  const moment = imports.moment;
  const formElement = params.formElement;
  const _ = imports.lodash;
  let visibility = true;
  let value = null;
  let answersToSkip = [];
  let validationErrors = [];
  
  const groupSubject = params.entityContext.group;
  if(groupSubject.groupSubjects.length > 0) {
     const ind = params.entityContext.group.groupSubjects[0].memberSubject;
     const caste = ind.getObservationReadableValue('Caste');
     value = caste; 
  }
  
  return new imports.rulesConfig.FormElementStatus(formElement.uuid, visibility, value, answersToSkip, validationErrors);
};
```

## Handling special scenarios while updating value using FormElementStatus rule

### How to reset value using FormElement Rule logic

When the FormElementStatus value is set to null, by default it is treated as a No-action operation and hence we do not reset the value of the concept.

But instead, if we are trying to say that "I am not setting the value", and any previous value has to be reset, then we need to specify the resetValueIfNull argument to be **true** in the FormElementStatus constructor, used to generate response during the rule execution.

```
'use strict';
({params, imports}) => {

//Rule content
  
//FormElementStatus Constructor signature
return new imports.rulesConfig.FormElementStatus(formElementUUID, visibility, value, answersToSkip = [], validationErrors = [], answersToShow = [], resetValueIfNull = false);
}
```

<br />

### Handle set of Modifiable Select Coded Concepts

In-order to init a modifiable Select Coded Concept FormElement's Value in a form, you can specify the AnswerConcept **Name** as the value, which should be enough to set the initial value as expected.

### Handle set of Read-Only Select Coded Concepts

There were 2 issues that were preventing implementation team from reliably setting a **Read-only** SingleSelectCodeConcept's value via FormElement Rules:

1. Selection of a AnswerConcept
2. Stablizing the selected value over multiple execution of FormElement rule due to changes elsewhere in the FormElementGroup

#### Recommended solution

To resolve these issues, we only needed to make following adjustments in the FormElement Rule:

1. Selection of a AnswerConcept => Make use of AnswerConcept's UUID instead of name as value
2. Stablizing the selected value  => 
   > - Mark the SelectedCodedConcept value as ReadOnly 
   > - For Multi-select: Return a FormElementStatus object with only the difference between previous valueArray and new valueArray. If no change in value, then return empty array.
   > - For Single-select: Return a FormElementStatus object with selected value, only if previousValue was null. If not, return null.

This would toggle the answers as expected and result in only the expected value(s) being shown as selected. 

#### Example Rule for SingleSelect FormElement set via Rule

```javascript
'use strict';
({params, imports}) => {
  const individual = params.entity;
  const moment = imports.moment;
  const formElement = params.formElement;
  const _ = imports.lodash;
  let visibility = true;
  let value = null;
  let answersToSkip = [];
  let validationErrors = [];
    
    const condition11 = triue; //some visibility condition
    visibility = condition11;
     
    if (condition11) {
       //some business logic
          if(someCondition) {
             value = "conceptUUID1";
          }
          else{
             value = "conceptUUID2";
          }
       }
    }
    let que = individual.findGroupedObservation('bafb80ac-6088-4649-8ed3-0501e1296c6e')[params.questionGroupIndex];
    if(que){
      let obs = que.findObservationByConceptUUID('ef952d55-f879-4c34-99e2-722c680ed2e2');
      if(obs && obs.getValue() === value) {//i.e obs.getValue() are both same answerConcept
         return null;//Old value is retained
       }   
    }
    else {
       return new imports.rulesConfig.FormElementStatus(formElement.uuid, visibility, value, answersToSkip, validationErrors); //new value is updated
    }
};
```

### Handle Uniqueness validation for Read-Only Text field

As the value for the ReadOnly TextFormElement is set via Rule of some sort, the validation for enforcing uniqueness too has to be done during the same rule execution.

#### Example FE rule for enforcing Uniqueness validation on Read-only Text field

```Text Javascript
'use strict';
({params, imports}) => {
    const individual = params.entity;
    const moment = imports.moment;
    const _ = imports.lodash;
    const formElement = params.formElement;
    let visibility = true;
    let value = null;
    let validationErrors = [];
    let nameNotUnique = false;
    
    
   //Business logic to set value
   value = '[dummy3]as';


    //Execute some business logic to update nameNotUnique 
    nameNotUnique = (value === '[dummy3]as');
    
    if(nameNotUnique) {
       validationErrors.push('Another Work Order has same value');
    }
   
    return new imports.rulesConfig.FormElementStatus(formElement.uuid, visibility, value, null, validationErrors);
};

```

<br />

### Handle Fetch of Individuals with specific Phone Numbers for duplicates validation

For business reasons, we might need to verify that there are **No / Limited number of** duplicate Subjects with the same Phone Number. To do this, we have 2 possible approaches:

#### 1. Use IndividualServiceFacade "findAllSubjectsWithMobileNumberForType" helper method

Use IndividualServiceFacade.findAllSubjectsWithMobileNumberForType(mobileNumber, subjectTypeUUID) method to get subjects with same phone number.

**Requires the PhoneNumber concept to have, KeyValue (primary_contact : yes) or (contact_number : yes)**
![](https://files.readme.io/f48da098be8218e797e7dd841e023036199eb0b7aa696ece422a6974e0b3f56f-421821795-e7b7766d-3865-4a66-a66e-93f4ddc8b13d.png)

```js

  const individualService = params.services.individualService;
  const subjects = individualService.findAllSubjectsWithMobileNumberForType('<phone_number>', "<subject_type_uuid>");
  console.log('found subjects with number', subjects && subjects.length > 0);
  
```

#### 2. [Using params.db object to find duplicates with custom filter logic](/docs/writing-rules#using-paramsdb-object-when-writing-rules)

## Types of rules and their support/availability in Data Entry App

| Not supported                          | Supported via rules-server       | Supported in browser     |
| :------------------------------------- | :------------------------------- | :----------------------- |
| Global reusable function               | Enrolment eligibility check rule | Form Element Rule        |
| Dashboard Card rule (NA)               | Encounter eligibility check rule | Form Element GroupRule   |
| Checklists rule                        | Visit schedule rule              | Enrolment Summary Rule   |
| Work list updation rule                | Message rule                     | Hyperlink menu item rule |
| Hyperlink menu item rule               | Decision rule                    |                          |
| Validation rule                        |                                  |                          |
| Edit Form rule                         |                                  |                          |
| Member addition eligibility check rule |                                  |                          |

## Types of rules and their support/availability in transaction data upload

| Not supported | Supported via rules-server | Not Applicable                   |
| :------------ | :------------------------- | :------------------------------- |
| Message rule  | Visit schedule rule        | Hyperlink menu item rule         |
|               | Decision rule              | Enrolment Summary Rule           |
|               | Validation rule            | Form Element GroupRule           |
|               |                            | Form Element Rule                |
|               |                            | Encounter eligibility check rule |
|               |                            | Enrolment eligibility check rule |
|               |                            | Hyperlink menu item rule         |
|               |                            | Work list updation rule          |
|               |                            | Checklists rule                  |
|               |                            | Dashboard Card rule              |

---
