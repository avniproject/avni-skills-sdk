# Avni bundle — entity JSON shapes

The exact JSON shape of each bundle entity, the keys the server requires, and the
**closed enum sets** you must never invent values for. Derived from the
server-contract validator (`bundle_validator.js`, 28 codes) and the avni-server
JPA models. When in doubt, copy the field shape of an existing neighbour in the
same file verbatim — never invent keys the generator doesn't emit.

> All UUIDs are v4-shaped: `8-4-4-4-12` lowercase hex. NEVER invent short tokens
> like `c-cancel-001` or `ans-other`. Use `crypto.randomUUID()` or copy an
> existing UUID when referencing one.

---

## `concepts.json` — array of Concept

```jsonc
{
  "name": "Religion",          // required, unique case-insensitively (C3/D1)
  "uuid": "…",                 // required, v4, unique (D2)
  "dataType": "Coded",         // required, MUST be in the dataType enum below (C4)
  "answers": [                 // Coded only: each answer ALSO exists as a standalone concept (C5)
    { "name": "Hindu",  "uuid": "…", "order": 1 },
    { "name": "Other",  "uuid": "…", "order": 99 }   // reuse the shared "Other" UUID
  ]
}
```

- **C5**: every `answers[].uuid` must resolve to a standalone concept (typically
  `dataType: "NA"`) present in this same `concepts.json`.
- **C3/D1**: concept names collide **case-insensitively** — `"Other"` and
  `"other"` are a duplicate. Run `bundle_find_concept` before adding any concept.
- **C7**: a name used as a question concept may NOT also be used as an answer
  concept (and vice-versa).

### Concept `dataType` — closed enum (C4)

```
Numeric, Text, Notes, Coded, NA, Date, DateTime, Time, Duration, Image,
ImageV2, Id, Video, Subject, Location, PhoneNumber, GroupAffiliation,
Audio, File, QuestionGroup, Encounter
```

---

## `forms/*.json` — one file per Form

```jsonc
{
  "name": "Beneficiary Registration",
  "uuid": "…",
  "formType": "IndividualProfile",      // closed enum below (F9)
  "formElementGroups": [
    {
      "name": "Default",
      "uuid": "…",
      "formElements": [
        {
          "name": "Full Name",
          "uuid": "…",
          "displayOrder": 1,            // unique within the group (F1)
          "concept": {                  // ALWAYS a nested object — see below
            "name": "Full Name",
            "uuid": "…",
            "dataType": "Text",
            "answers": [],
            "media": []
          }
        }
      ]
    }
  ]
}
```

### `formElement.concept` MUST be a nested object (FE_CONCEPT_NOT_OBJECT)

The server's Jackson deserializer expects a `ConceptContract` object. A bare UUID
string `"concept": "<uuid>"` crashes the import (`MismatchedInputException`) — and
the **local validator does not catch it**. Minimum keys: `{ name, uuid, dataType }`
(usually also `answers: [], media: []`). If you edit a formElement, copy the full
nested concept object verbatim. This is the *Durga* trap.

- **F2**: the same concept UUID must not appear twice as non-voided elements in
  one form.
- **F5**: every `formElement.concept.uuid` must resolve to an entry in
  `concepts.json`.

### `formType` — closed enum (F9)

```
IndividualProfile, ProgramEnrolment, ProgramExit, ProgramEncounter,
ProgramEncounterCancellation, Encounter, IndividualEncounterCancellation
```

---

## `subjectTypes.json` — array of SubjectType

```jsonc
{ "name": "Beneficiary", "uuid": "…", "type": "Person" }   // type: Person | Individual | Household | Group | User | ...
```

- A subjectType is the registration root. Its registration form is an
  `IndividualProfile` form linked via `formMappings.json`.

## `programs.json` — array of Program

```jsonc
{ "name": "Programme", "uuid": "…", "subjectTypeUuid": "…" }   // subjectTypeUuid must resolve
```

## `encounterTypes.json` — array of EncounterType

```jsonc
{ "name": "Programme Visit", "uuid": "…", "programUuid": "…", "conceptUuid": null }
```

- `programUuid` only for program encounter types. `conceptUuid` (display concept)
  is an optional FK — if present it must resolve.

---

## `formMappings.json` — array of FormMapping (the FK heart, M1–M5)

```jsonc
{
  "uuid": "…",
  "formUUID": "…",              // → a forms/*.json (required, M-class)
  "subjectTypeUUID": "…",       // → subjectTypes.json (required)
  "programUUID": "…",           // required IFF the form's formType requires it
  "encounterTypeUUID": "…"      // required IFF the form's formType requires it
}
```

**Which FK fields a mapping requires is decided by the carrying form's
`formType`** — see `fk-matrix.yaml` (`formTypes:` block). Summary:

| formType | programUUID | encounterTypeUUID |
|---|---|---|
| IndividualProfile | — | — |
| ProgramEnrolment | required | — |
| ProgramExit | required | — |
| ProgramEncounter | required | required |
| ProgramEncounterCancellation | required | required |
| Encounter | — | required |
| IndividualEncounterCancellation | — | required |

> `programUUID` is present ONLY for `ProgramEncounterCancellation` among the
> cancellation types — do NOT add a `programUUID` to an
> `IndividualEncounterCancellation` mapping.

---

## `operational*.json` — operational mirrors

`operationalSubjectTypes.json`, `operationalPrograms.json`,
`operationalEncounterTypes.json`. Each entry mirrors one base entity by its UUID.
Tolerate both the wrapped (`{ "operationalSubjectTypes": [...] }`) and bare-array
shapes — but emit the wrapped shape the generator uses. Every operational entry
must reference a base entity that exists.

---

## `addressLevelTypes.json` — array of AddressLevelType (ALT_INVALID_NAME)

```jsonc
{ "name": "District", "uuid": "…", "level": 2.0, "parentUuid": "…" }
```

- **name**: non-empty and free of `< > = " '`. Avni's `LocationService` rejects
  `^.*[<>="'].*$`. URLs (query strings carry `=` `'` `"`), HTML, and arrow-chain
  diagram rows copied from an SRS are the common offenders. This is the *Astitva*
  trap — **invisible to the local validator**.
- `parentUuid` (optional FK) must resolve to another addressLevelType.

---

## `groupRoles.json`, `groups.json`, `groupPrivilege.json`, `taskTypes.json`

- `groupRole` carries two FKs to `subjectType` (the group's subjectType and the
  member's). Both must resolve (graph-only edges).
- `groupPrivilege.privilegeType` — closed enum (G2):

```
ViewSubject, RegisterSubject, VoidSubject, EditSubject, EnrolSubject,
UnVoidSubject, ExitEnrolment, VoidEnrolment, UnVoidEnrolment, ViewVisit,
PerformVisit, EditVisit, CancelVisit, ScheduleVisit, VoidVisit, UnVoidVisit,
ViewChecklist, EditChecklist
```

---

## Golden rules

1. NEVER invent a UUID, enum value, or entity key. Copy from a neighbour or the
   closed enum sets above.
2. ATOMICITY — when you reference a UUID, the target must exist in the same turn.
   No dangling references.
3. `formElement.concept` is always a nested object (FE_CONCEPT_NOT_OBJECT).
4. `addressLevelType` names have no `< > = " '` (ALT_INVALID_NAME).
5. Run `bundle_validator_run` AND `bundle_integrity_check` before export — a clean
   validator does not guarantee a clean upload.
