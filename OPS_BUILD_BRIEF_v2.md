# JetDeck — Part 135 Operations Build Brief
**Version 2.0 | Full Compliance Suite | For use with Claude Code**

---

## Overview & Scope

This brief covers the complete Part 135 on-demand charter operations compliance suite for JetDeck. It replaces the lightweight Ops Brief v1.0 with a full regulatory-grade system covering every FAA-required compliance function for a Part 135 certificate holder.

**This is not a workflow convenience tool. It is a compliance management system that happens to be convenient.**

Every feature in this brief exists because Part 135 regulations require it, or because failing to track it creates certificate risk, liability exposure, or operational breakdown. Build it with that seriousness.

---

## Founding Operator Context

- **Clarity Aviation** — Part 135 on-demand charter, transitioning from Part 91
- **Fleet:** 2–3 managed aircraft
- **Ops team:** Solo operator (all hats)
- **Crew:** Own employed/contracted pilots and flight attendants
- **Flight planning:** ForeFlight — JetDeck complements, does not replace
- **Maintenance:** Existing CAMP program — JetDeck integrates, does not replace
- **DAAP:** Establishing as part of Part 135 transition — JetDeck houses records
- **Crew portal:** Both mobile app (React Native/Expo) AND mobile-optimized web

---

## Two-Codebase Architecture

The Part 135 operations suite requires two applications sharing one backend:

### Application 1: JetDeck Web (existing Next.js app)
- Operator-facing ops dashboard
- Compliance management views
- Document management
- Full admin and reporting
- Accessible on desktop and mobile browser
- Crew portal also accessible here (web version)

### Application 2: JetDeck Crew (new React Native / Expo mobile app)
- Crew-facing only
- Available on iOS and Android via App Store / Google Play
- Primary functions: view trips, accept/decline, log duty times, log flight times, view currency, acknowledge manuals, report discrepancies
- Push notifications for new trip assignments, compliance alerts, manual revisions
- Works with limited connectivity (offline-capable for key views)
- Shares the same Next.js API routes and Neon database as the web app
- Auth via Clerk Expo SDK (same Clerk organization)

### Shared infrastructure (no changes needed)
- All API routes live in the existing Next.js app
- Crew mobile app is a pure API consumer — no separate backend
- Same Prisma database, same Clerk auth, same multi-tenant operator isolation

### Tech additions for mobile app

| Layer | Choice |
|---|---|
| Mobile framework | Expo SDK 51+ (React Native) |
| Navigation | Expo Router (file-based, mirrors Next.js patterns) |
| Auth | @clerk/clerk-expo |
| Push notifications | Expo Notifications + Expo Push Notification Service |
| Offline storage | expo-sqlite (cache key data locally) |
| PDF viewing | expo-pdf-viewer (for manuals) |
| Signature capture | expo-signature-canvas (for electronic acknowledgments) |
| Secure storage | expo-secure-store (auth tokens) |
| Deployment | EAS Build + EAS Submit (Expo Application Services) |

---

## Part 135 Regulatory Reference

Every compliance module in this brief maps to specific regulations. This table is the authority — if there is ever a question about what to track or how, refer to the CFR first.

| Regulation | Subject | JetDeck Module |
|---|---|---|
| 14 CFR 135.61 | Required aircraft records | Module D |
| 14 CFR 135.63 | Recordkeeping requirements | Module K |
| 14 CFR 135.95 | Airmen: Limitations on use | Module C |
| 14 CFR 135.243 | PIC qualifications | Module C |
| 14 CFR 135.245 | SIC qualifications | Module C |
| 14 CFR 135.261 | Flight time limitations — all operations | Module B |
| 14 CFR 135.263 | Flight time limitations — scheduled operations (ref only) | Module B |
| 14 CFR 135.265 | Flight time limitations — unscheduled operations (key) | Module B |
| 14 CFR 135.267 | Flight time limitations — all certificate holders | Module B |
| 14 CFR 135.269 | Flight time limitations — helicopter (ref only) | Module B |
| 14 CFR 135.271 | Helicopter hospital emergency operations (ref only) | Module B |
| 14 CFR 135.273 | Duty period limitations — flight crew | Module B |
| 14 CFR 135.293 | Initial/recurrent pilot testing | Module C |
| 14 CFR 135.295 | Initial/recurrent flight attendant testing | Module C |
| 14 CFR 135.297 | PIC instrument proficiency check | Module C |
| 14 CFR 135.299 | PIC line checks | Module C |
| 14 CFR 135.301 | Crewmember tests and checks | Module C |
| 14 CFR 135.321 | Training program requirements | Module C |
| 14 CFR 135.341 | Pilot and flight attendant crewmember training programs | Module C |
| 14 CFR 135.345 | Pilots: Initial ground training | Module C |
| 14 CFR 135.347 | Pilots: Initial flight training | Module C |
| 14 CFR 135.349 | Flight attendants: Initial training | Module C |
| 14 CFR 135.351 | Recurrent training | Module C |
| 14 CFR 135.383 | Special PIC qualification: Routes and airports | Module C |
| 14 CFR 135.385 | Large transport category — destination alternate | Module F |
| 14 CFR 120 (Subpart F/G) | Drug and alcohol testing | Module I |
| 49 CFR 40 | Drug/alcohol testing procedures | Module I |
| 14 CFR 135.63(a)(4) | Pilot records (PRIA) | Module C |

---

## Module A: Crew Portal

The crew-facing interface. Available as both a mobile app (primary) and a mobile-optimized web view (secondary). Crew should be able to complete every required compliance action from their phone.

### A.1 — Authentication & Onboarding

**Mobile app auth flow:**
- Crew downloads JetDeck Crew from App Store / Google Play
- Enters their work email → Clerk sends magic link or OTP
- On first login: prompted to complete their profile
  - Personal info (legal name, address, emergency contact)
  - Certificate numbers (ATP/CPL, medical)
  - Upload certificate images
  - Acknowledge current manuals (cannot proceed until complete)

**Role-based access:**
Crew see only their own data and their assigned trips. They cannot see other crew members' compliance details, pay rates, client information, or financial data.

### A.2 — Home Screen / Dashboard

The crew portal home screen shows exactly what the crew member needs to know right now:

```
┌─────────────────────────────────────┐
│  Good morning, James                │
│                                     │
│  NEXT TRIP                          │
│  TEB → MIA  |  Jan 15, 10:00 AM    │
│  N123CL  |  PIC                     │
│  [View Details]  [Confirm]          │
│                                     │
│  YOUR STATUS                        │
│  Flight time (24hr):  3.2 / 8.0 hr │
│  Flight time (30d):   42.1 hr       │
│  Flight time (YTD):   387 hr        │
│  Rest remaining:      6h 22m        │
│                                     │
│  ⚠️  IPC due in 23 days             │
│  ✓  Medical current (Jun 2026)      │
│  ✓  All manuals acknowledged        │
│                                     │
│  [Log Duty]  [Log Flight]           │
└─────────────────────────────────────┘
```

### A.3 — Trip View & Assignment Acceptance

**My Trips screen:**
- List of all assigned trips (upcoming, in progress, recent)
- Each trip shows: date, route, aircraft, role (PIC/SIC/FA), status
- Tap trip → full detail view

**Trip detail view (crew-facing):**
- Flight details: route, scheduled block out/in, aircraft tail
- Passenger count (no passenger names until manifest complete and operator shares)
- Fellow crew members on the trip
- Checklist of what's needed from them:
  - [ ] Accept this assignment
  - [ ] Duty time check (auto-calculated — green/yellow/red)
  - [ ] Currency check (auto-calculated)
  - [ ] Required manuals acknowledged
- FBO information (departure and arrival)
- Operator notes for the trip
- Contact: operator phone number

**Assignment acceptance:**
When a new trip is assigned, crew receive a push notification. In the app:
- Full trip details shown
- Their duty/rest status for that period shown (will they be legal?)
- Currency status shown
- "Accept Assignment" button → records acceptance with timestamp
- "Unable to Accept" button → prompts for reason (scheduling conflict, rest, personal) → notifies operator immediately

**Conflict warnings on accept:**
If accepting the trip would create a regulatory issue, the system shows:
- 🔴 RED — "Cannot accept: You will have insufficient rest before this flight (need 9h, have 7h 22m)" — blocks acceptance, requires operator override
- 🟡 YELLOW — "Warning: This flight will bring you to 94% of your 24-hour flight time limit" — allows acceptance with acknowledgment
- System logs all warnings and crew responses for audit purposes

### A.4 — Duty Time Logging

Crew log duty periods directly in the app. A duty period begins when reporting for duty and ends when released.

**Logging flow:**
- "Start Duty" button → records duty start timestamp (GPS timestamp, cannot be backdated more than 15 minutes)
- During duty: live timer showing elapsed duty time and remaining allowable duty
- "End Duty" button → records duty end, calculates rest period start
- Rest period countdown begins immediately

**Manual entry (for back-fill):**
- Crew can enter duty periods for past dates (up to 7 days back)
- Late entries flagged in audit log
- Operator notified of late entries

**Duty period fields:**
- Duty start (date + time + timezone)
- Duty end (date + time + timezone)
- Duty type: Flight Duty | Training | Deadhead | Standby | Administrative
- Trip association (auto-linked if within assigned trip window)
- Notes (optional)

### A.5 — Flight Time Logging

After each flight leg, the PIC and SIC both log:

**Flight log entry fields:**
- Aircraft tail number (auto-filled from trip assignment)
- Departure airport (ICAO)
- Arrival airport (ICAO)
- Block out time (date + time + timezone)
- Takeoff time
- Landing time
- Block in time (date + time + timezone)
- Flight time (calculated: takeoff to landing, displayed for confirmation)
- Block time (calculated: block out to block in)
- Conditions:
  - [ ] Instrument flight (actual IMC)
  - Instrument approaches: number + type (ILS/RNAV/VOR) + airport + runway
  - Night time (hours)
  - Day landings
  - Night landings
- Crew role: PIC | SIC | Relief PIC
- Passengers carried (count)
- Fuel uplift (gallons, at departure FBO)
- Any irregularities or incidents (free text)
- Squawk entry (links to Module D discrepancy system)

**Auto-updates on submission:**
- Crew flight time accumulators (24hr, 7d, 30d, 90d, 365d)
- Currency counters (instrument approaches, day/night landings)
- Aircraft total time (airframe hours)
- Trip flight log record

**PIC approval:**
For each leg, the PIC must submit. SIC's log for the same leg is cross-referenced. If times differ by more than 2 minutes, flagged for review.

### A.6 — Currency Dashboard

A personal compliance view showing the crew member's own currency and certificate status.

```
MY CURRENCY STATUS

CERTIFICATES
  ATP Certificate          ✓ Current
  Medical (Class 1)        ✓ Current — Expires Jun 15, 2026  (187 days)
  Type Rating: CE-560XL    ✓ Current

FLIGHT CURRENCY
  Instrument Approaches    ✓ 4 of 6 required (in past 6 months)
                             Need 2 more by Mar 15, 2026
  Day Landings (90 day)    ✓ 8 landings (need 3 minimum)
  Night Landings (90 day)  ⚠️ 2 landings (need 3 by Feb 28, 2026 — 18 days)
  Night T/O (90 day)       ⚠️ 2 (need 3 by Feb 28, 2026 — 18 days)

TRAINING & CHECKS
  Instrument Prof. Check   ✓ Completed Oct 12, 2025 — Due Apr 12, 2026
  Recurrent Training       ✓ Completed Aug 2025 — Due Aug 2026
  Line Check               ✓ Completed Sep 2025 — Due Sep 2026
  Emergency Procedures     ✓ Completed Aug 2025 — Due Aug 2026

DRUG & ALCOHOL
  Last Random Test         ✓ Jan 3, 2026 (Negative)
  Pre-employment           ✓ On file
```

Push notifications sent to crew when:
- Any currency item expires within 30 days
- Any certificate expires within 60 days
- A training event is due within 30 days

### A.7 — Manual Acknowledgment

When operator uploads a new or revised manual, all affected crew receive a push notification and cannot accept new trip assignments until they acknowledge.

**Acknowledgment flow:**
- Notification: "New revision of General Operations Manual requires your acknowledgment"
- Crew opens the document in the app (PDF viewer)
- After reaching the last page OR after 60 seconds of viewing: "Acknowledge" button appears
- Crew taps Acknowledge → records timestamp, device info, document version hash
- This acknowledgment is the legal record of receipt

**In the app:**
- "My Documents" tab shows all manuals with acknowledgment status
- Unacknowledged documents shown prominently with a red badge on app icon

### A.8 — Discrepancy Reporting (Crew)

Crew can report aircraft discrepancies directly from the mobile app.

**Discrepancy entry:**
- Aircraft (auto-filled from current trip or select from list)
- Description (free text, required)
- When noted: Before flight | During flight | After flight
- Severity: Deferred (MEL) | Cosmetic | Potentially Grounding
- Photos (up to 5 photos from camera or library)
- Crew name auto-filled from logged-in user

On submit:
- Discrepancy appears immediately in operator's dashboard
- If "Potentially Grounding" — operator receives immediate push notification
- Crew receives confirmation with discrepancy reference number

---

## Module B: Duty & Flight Time Compliance Engine

The regulatory heart of the system. This module tracks every crew member's accumulated flight time and duty periods in real time and enforces Part 135 limitations before they are violated.

### B.1 — Regulatory Rules Engine

The following Part 135 limits are enforced. All times are tracked on a rolling basis (not calendar-based):

**Flight time limits (135.265 — Unscheduled operations, which applies to on-demand charter):**

| Period | Single Pilot | Multi-crew |
|---|---|---|
| 24 consecutive hours | 8 hours | 10 hours |
| 7 consecutive days | Not specified in 135.265 (tracked for internal purposes) | Same |
| 30 consecutive days | Not specified (tracked) | Same |
| 90 consecutive days | Not specified (tracked) | Same |
| 365 consecutive days | 1,200 hours | 1,200 hours |

**Note:** 135.265 applies specifically to on-demand operations. The system should be configurable for operators who also hold scheduled service authority.

**Rest requirements (135.267):**
- Minimum rest before a flight duty period: **9 consecutive hours** (multi-crew)
- Minimum rest before a flight duty period: **10 consecutive hours** (single pilot)
- Rest period begins when the crew member is released from duty
- Rest period calculation uses local time at rest location

**Duty period limits:**
Part 135.273 does not set a specific maximum duty period for on-demand operations but the system tracks:
- Total duty period duration (block to release)
- Duty periods within 24 hours
- This data is captured and available for operators who set their own internal limits or have OpSpec restrictions

**Alert thresholds (configurable per operator):**
- 🟡 WARNING: 75% of any limit reached
- 🔴 CRITICAL: 90% of any limit reached
- 🚫 VIOLATION: Limit reached or exceeded

### B.2 — Accumulator Tracking

Every crew member has rolling accumulators maintained in real time:

```prisma
model FlightTimeAccumulator {
  id              String     @id @default(cuid())
  operatorId      String
  crewMemberId    String
  crewMember      CrewMember @relation(fields: [crewMemberId], references: [id])

  // Rolling totals — updated every time a flight log is submitted
  hours24         Float      @default(0)  // last 24 consecutive hours
  hours7d         Float      @default(0)  // last 7 days
  hours30d        Float      @default(0)  // last 30 days
  hours90d        Float      @default(0)  // last 90 days
  hours365d       Float      @default(0)  // last 365 days (the 1200hr limit)

  // Duty period tracking
  lastDutyStart   DateTime?
  lastDutyEnd     DateTime?
  lastRestStart   DateTime?
  restHoursAvailable Float?  // calculated: hours until minimum rest satisfied

  // Limits applicable to this crew member
  singlePilotOps  Boolean    @default(false)  // if true, uses 8hr/24hr limit

  updatedAt       DateTime   @updatedAt
}
```

**Recalculation strategy:**
When a flight log is submitted:
1. All accumulators for that crew member recalculated from raw flight log data
2. Do NOT maintain running totals that drift — always recalculate from source data
3. Flag any result that violates a limit → create `ComplianceAlert` record
4. Update `FlightTimeAccumulator` with fresh totals

This approach is slower but accurate. Accumulator drift from bad data is a compliance risk.

### B.3 — Pre-Assignment Availability Check

Before a crew member can be assigned to a trip, the system runs an automated check:

**Inputs:**
- Crew member ID
- Proposed duty start time
- Estimated duty end time (based on trip length + buffer)
- Crew role (single pilot or multi-crew)

**Checks performed:**
1. **Rest requirement:** Has crew member had minimum required rest since last duty period?
2. **24-hour flight time:** Will the estimated flight hours put them over the 24-hour limit?
3. **365-day flight time:** Are they within 100 hours of the 1,200-hour annual cap?
4. **Currency:** Are they current for this aircraft category? (instrument, day/night landings)
5. **Certificate validity:** Medical current? Type rating current?
6. **Training current:** All required recurrent training within limits?
7. **Manuals acknowledged:** All current manual revisions acknowledged?
8. **DAAP status:** No pending follow-up tests? Not in return-to-duty protocol?

**Result:** 
- ✅ AVAILABLE — all checks pass
- ⚠️ CONDITIONAL — passes with warnings (near a limit)
- 🚫 UNAVAILABLE — fails one or more hard checks with specific reasons

Operator can override CONDITIONAL with a note. UNAVAILABLE requires regulatory justification to override and is logged prominently in the audit trail.

---

## Module C: Crew Records & Qualifications

Complete crew qualification and training record management in compliance with Part 135 Subpart E and G.

### C.1 — Crew Member Profile

```prisma
model CrewMember {
  id               String    @id @default(cuid())
  operatorId       String
  clerkUserId      String?   @unique  // if they have a JetDeck login
  
  // Personal
  firstName        String
  lastName         String
  email            String
  phone            String?
  address          String?
  emergencyContact Json?     // { name, phone, relationship }
  hireDate         DateTime?
  terminationDate  DateTime?
  status           String    @default("active")
  // "active" | "inactive" | "on_leave" | "terminated"

  // Role
  role             String    // "pic" | "sic" | "flight_attendant" | "check_airman"
  employmentType   String    // "employee" | "contractor"

  // Certificate information
  certificateType  String?   // "ATP" | "commercial" | "private"
  certificateNumber String?
  certificateImageUrl String?

  // Medical
  medicalClass     String?   // "1" | "2" | "3" | "BasicMed"
  medicalExpiry    DateTime?
  medicalImageUrl  String?

  // Aircraft qualifications
  qualifications   CrewQualification[]

  // Relations
  certificates     CrewCertificate[]
  trainingRecords  TrainingRecord[]
  currencyItems    CrewCurrency[]
  dutyPeriods      DutyPeriod[]
  flightLogs       FlightLog[]
  drugTests        DrugTestRecord[]
  tripAssignments  TripCrew[]
  accumulators     FlightTimeAccumulator[]
  manualAcks       ManualAcknowledgment[]
  pria             PRIARecord[]

  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
}

model CrewQualification {
  id              String     @id @default(cuid())
  crewMemberId    String
  crewMember      CrewMember @relation(fields: [crewMemberId], references: [id])
  aircraftCategory String    // "light" | "midsize" | "super_midsize" | "heavy"
  specificTail    String?    // if qualified on a specific tail
  typeRating      String?    // e.g. "CE-560XL"
  typeRatingExpiry DateTime?
  qualifiedAsPIC  Boolean   @default(false)
  qualifiedAsSIC  Boolean   @default(true)
  addedAt         DateTime  @default(now())
}
```

### C.2 — Certificate Tracking

Every certificate, rating, and authorization tracked with expiry alerts.

```prisma
model CrewCertificate {
  id              String     @id @default(cuid())
  operatorId      String
  crewMemberId    String
  crewMember      CrewMember @relation(fields: [crewMemberId], references: [id])
  
  type            String
  // "atp" | "commercial" | "medical_1" | "medical_2" | "basicmed"
  // "type_rating" | "flight_instructor" | "check_airman_auth"
  // "rvsm_auth" | "custom"

  label           String     // display name
  identifier      String?    // certificate or rating number
  issuedDate      DateTime?
  expiryDate      DateTime?
  imageUrl        String?    // uploaded scan
  notes           String?

  // Alert config
  alertDaysBefore Int        @default(60)

  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
}
```

### C.3 — Flight Currency Tracking

Currency is auto-calculated from flight logs. This model stores the calculated state.

```prisma
model CrewCurrency {
  id              String     @id @default(cuid())
  operatorId      String
  crewMemberId    String
  crewMember      CrewMember @relation(fields: [crewMemberId], references: [id])

  type            String
  // "instrument_approaches" — 6 in 6 months per 135.297
  // "day_landings"          — 3 in 90 days per 135.299
  // "night_landings"        — 3 in 90 days
  // "night_takeoffs"        — 3 in 90 days
  // "category_class"        — general recency per 61.57

  aircraftCategory String?   // applies to this category only

  // Rolling counts (recalculated from flight logs)
  countLast90d    Int        @default(0)
  countLast6mo    Int        @default(0)

  // Oldest qualifying event (determines expiry)
  oldestQualifyingDate DateTime?
  expiresAt       DateTime?  // calculated: oldestQualifyingDate + window

  isCurrent       Boolean    @default(true)
  lastCalculatedAt DateTime?

  updatedAt       DateTime   @updatedAt
  @@unique([crewMemberId, type, aircraftCategory])
}
```

### C.4 — Training Records

Every required training event tracked per 135.321, 135.341, 135.351.

```prisma
model TrainingRecord {
  id              String     @id @default(cuid())
  operatorId      String
  crewMemberId    String
  crewMember      CrewMember @relation(fields: [crewMemberId], references: [id])

  type            String
  // "initial_ground"         — 135.345
  // "initial_flight"         — 135.347
  // "recurrent_ground"       — 135.351
  // "recurrent_flight"       — 135.351
  // "emergency_procedures"   — 135.331
  // "ipc"                    — instrument proficiency check 135.297
  // "line_check"             — 135.299
  // "pic_qualification"      — 135.293
  // "sic_qualification"      — 135.293
  // "check_airman"           — if applicable
  // "fa_initial"             — 135.349
  // "fa_recurrent"           — 135.351
  // "custom"

  label           String     // display name
  completedDate   DateTime
  expiryDate      DateTime?  // calculated based on type (6mo IPC, 12mo recurrent, etc.)
  conductedBy     String?    // name of instructor / check airman
  conductedAt     String?    // location / simulator facility
  aircraftTail    String?    // if conducted in aircraft
  aircraftSimulator String?  // if conducted in simulator (Level D, FTD, etc.)
  grade           String?    // "satisfactory" | "unsatisfactory"
  notes           String?
  documentUrl     String?    // upload training completion doc / 8710

  // Next due (for recurrent items)
  nextDueDate     DateTime?
  isRecurrent     Boolean    @default(false)
  recurrenceMonths Int?      // 6 for IPC, 12 for recurrent training

  createdAt       DateTime   @default(now())
}
```

**Training due date rules (hardcoded in the compliance engine):**

| Training Type | Interval | Reference |
|---|---|---|
| Instrument Proficiency Check | 6 calendar months | 135.297 |
| Recurrent ground training | 12 calendar months | 135.351 |
| Recurrent flight training | 12 calendar months | 135.351 |
| Emergency procedures | 12 calendar months | 135.331 |
| Line check | 12 calendar months | 135.299 |
| Medical (ATP, Class 1, under 40) | 12 calendar months | 61.23 |
| Medical (ATP, Class 1, over 40) | 6 calendar months | 61.23 |

### C.5 — PRIA Compliance

Pilot Records Improvement Act requires operators to request records from FAA and previous employers for any pilot who may act as PIC.

```prisma
model PRIARecord {
  id              String     @id @default(cuid())
  operatorId      String
  crewMemberId    String
  crewMember      CrewMember @relation(fields: [crewMemberId], references: [id])

  // FAA records request
  faaRequestDate      DateTime?
  faaResponseDate     DateTime?
  faaRecordsUrl       String?   // uploaded FAA response

  // Previous employer requests
  previousEmployers   PRIAPreviousEmployer[]

  // Status
  status          String    @default("pending")
  // "pending" | "in_progress" | "complete" | "waived"

  completedAt     DateTime?
  notes           String?
  createdAt       DateTime  @default(now())
}

model PRIAPreviousEmployer {
  id              String     @id @default(cuid())
  priaId          String
  pria            PRIARecord @relation(fields: [priaId], references: [id])
  employerName    String
  requestDate     DateTime?
  responseDate    DateTime?
  responseUrl     String?    // uploaded response
  status          String     @default("pending")
}
```

**PRIA workflow in JetDeck:**
- When a new crew member is added with PIC role, a PRIA checklist is automatically created
- Operator is prompted to complete each step
- Crew member cannot be assigned as PIC until PRIA status is marked complete
- Records stored and retrievable for FAA inspection

---

## Module D: Aircraft Compliance & Discrepancy Management

JetDeck manages operational aircraft records and discrepancies. The existing CAMP program manages the maintenance schedule — JetDeck integrates with it rather than replacing it.

### D.1 — Aircraft Compliance Record

```prisma
model AircraftCompliance {
  id              String   @id @default(cuid())
  operatorId      String
  aircraftId      String   @unique
  aircraft        Aircraft @relation(fields: [aircraftId], references: [id])

  // Airframe hours (updated from flight logs)
  totalAirframeHours Float  @default(0)
  totalCycles        Int    @default(0)

  // Engine hours (per engine)
  engine1Hours    Float?
  engine1Cycles   Int?
  engine2Hours    Float?
  engine2Cycles   Int?
  apuHours        Float?

  // CAMP integration
  campLastSyncAt  DateTime?
  campSystemId    String?   // identifier in their CAMP system

  // Key maintenance dates (synced from CAMP or manually entered)
  lastAnnualDate  DateTime?
  nextAnnualDue   DateTime?
  last100hrDate   DateTime?
  next100hrDue    DateTime?

  // OpSpec authorizations
  rvsm            Boolean  @default(false)
  mnps            Boolean  @default(false)
  rnav10          Boolean  @default(false)
  rnav5           Boolean  @default(false)
  lpv             Boolean  @default(false)
  cpdlc           Boolean  @default(false)

  // Insurance
  insuranceExpiry DateTime?
  insuranceUrl    String?

  // Registration
  registrationExpiry DateTime?
  registrationUrl    String?

  // Airworthiness certificate (no expiry, but tracked)
  airworthinessUrl String?

  updatedAt       DateTime @updatedAt
}
```

### D.2 — CAMP Integration

CAMP (Continuous Airworthiness Maintenance Program) providers (CAMP Systems, Traxxall, ATP, Corridor) typically offer data export. JetDeck Phase 1 uses a manual import approach.

**Phase 1 — Manual sync:**
- Operator exports upcoming maintenance items from CAMP as CSV or PDF
- Uploads to JetDeck in the aircraft compliance section
- JetDeck parses and displays upcoming maintenance items
- Operator marks items complete after CAMP records the maintenance

**Phase 2 — API integration:**
- CAMP Systems and Traxxall both offer APIs
- JetDeck will pull aircraft hours, upcoming items, and AD status automatically
- Push discrepancies and squawks to CAMP when maintenance is deferred

```prisma
model MaintenanceItem {
  id              String   @id @default(cuid())
  operatorId      String
  aircraftId      String
  aircraft        Aircraft @relation(fields: [aircraftId], references: [id])

  // From CAMP or manual entry
  description     String
  type            String   // "inspection" | "ad" | "service_bulletin" | "component_overhaul" | "custom"
  reference       String?  // AD number, inspection item number, etc.

  // Due criteria (whichever comes first)
  dueDate         DateTime?
  dueHours        Float?
  dueCycles       Int?

  // Status
  status          String   @default("open")
  // "open" | "completed" | "deferred" | "na"

  completedDate   DateTime?
  completedHours  Float?
  completedBy     String?   // MX facility / IA name
  deferralApproval String?  // MEL reference or deferred per (regulatory authority)

  campItemId      String?   // reference ID in CAMP system
  sourceType      String    @default("manual") // "manual" | "camp_import" | "camp_api"

  notes           String?
  documentUrl     String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### D.3 — Discrepancy & Squawk Management

The primary aircraft maintenance write-up system. Discrepancies are entered by crew (via mobile app) or ops, evaluated, and either corrected or deferred per MEL.

**Discrepancy lifecycle:**
```
OPEN → (corrected) → CLOSED
OPEN → (deferred per MEL) → DEFERRED → (MEL expires or corrected) → CLOSED
OPEN → (grounding) → AOG → (corrected and returned to service) → CLOSED
```

```prisma
model Discrepancy {
  id              String   @id @default(cuid())
  operatorId      String
  aircraftId      String
  aircraft        Aircraft @relation(fields: [aircraftId], references: [id])
  tripId          String?
  tripLegId       String?

  referenceNumber String   // e.g. "D-2025-0142" — sequential per aircraft

  // Entry
  description     String
  discoveredWhen  String   // "preflight" | "inflight" | "postflight" | "maintenance"
  discoveredAt    DateTime
  reportedBy      String   // crew member name or "maintenance"
  reportedByCrewId String?
  photos          String[] // Vercel Blob URLs

  // Classification
  severity        String   @default("open")
  // "open" — unknown severity, needs evaluation
  // "cosmetic" — no operational impact
  // "deferred_mel" — deferred per MEL
  // "aog" — aircraft on ground, cannot fly
  // "corrected" — fixed

  // MEL deferral
  melReference    String?  // MEL item number
  melCategory     String?  // "A" (immediate) | "B" (3 days) | "C" (10 days) | "D" (120 days)
  melExpiry       DateTime? // calculated from deferral date and MEL category
  deferralApprovedBy String? // name of person who approved deferral (A&P, IA, DOM)
  deferralDate    DateTime?
  placard         String?   // required cockpit placard text per MEL

  // Resolution
  status          String   @default("open")
  correctedDate   DateTime?
  correctedBy     String?  // MX tech / IA
  correctionDescription String?
  returnToService String?  // RTS sign-off name and certificate number
  returnToServiceAt DateTime?
  workOrderNumber String?

  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

**AOG logic:**
When a discrepancy is marked `aog`:
- Aircraft status in the fleet is automatically set to `maintenance`
- All quotes and trips using that aircraft are flagged for ops review
- Operator receives an immediate notification
- Aircraft cannot be assigned to new quotes until discrepancy is resolved and RTS signed

**MEL deferral limits:**
MEL categories have regulatory time limits. System tracks:
- Category A: Must be corrected before next flight (effectively no deferral)
- Category B: Must be corrected within 3 consecutive calendar days
- Category C: Must be corrected within 10 consecutive calendar days
- Category D: Must be corrected within 120 consecutive calendar days

When a MEL item approaches its deferral limit:
- 48hrs before expiry: warning to operator
- At expiry: aircraft marked AOG until corrected

---

## Module E: Document & Manual Management

Complete document library with version control and mandatory crew acknowledgment tracking. This is a compliance requirement — operators must ensure crew have current manuals.

### E.1 — Document Library

Documents are organized by type:

**Operator documents:**
- General Operations Manual (GOM)
- Drug and Alcohol Program Manual (DAPM)
- Training Manual
- Emergency Response Plan
- Security Program
- Hazmat Manual (if applicable)
- Company Policies & Procedures

**Aircraft documents (per aircraft):**
- Aircraft Flight Manual (AFM) / Pilot Operating Handbook (POH)
- Minimum Equipment List (MEL)
- Weight and Balance Manual
- Aircraft Illustrated Parts Catalog (IPC) — reference only
- Maintenance Program / CAMP enrollment letter

**Reference documents:**
- 14 CFR Part 135 (linked, not uploaded)
- OpSpecs (uploaded PDF)
- Airport/route-specific materials
- FBO directory

### E.2 — Document Model

```prisma
model Document {
  id              String   @id @default(cuid())
  operatorId      String
  aircraftId      String?  // if aircraft-specific
  aircraft        Aircraft? @relation(fields: [aircraftId], references: [id])

  title           String
  type            String   // "gom" | "mel" | "afm" | "w_and_b" | "dapm" | "training" | "opspecs" | "custom"
  category        String   // "operator" | "aircraft" | "regulatory" | "reference"

  // Current version
  currentVersion  String   // e.g. "Rev 3.2"
  effectiveDate   DateTime
  fileUrl         String   // Vercel Blob URL
  fileHash        String   // SHA-256 hash of file (for acknowledgment records)
  fileSizeBytes   Int?

  // Acknowledgment requirements
  requiresCrewAck Boolean  @default(false)
  affectedRoles   String[] // ["pic", "sic", "flight_attendant"] — who must acknowledge

  // Previous versions (archived)
  previousVersions DocumentVersion[]
  acknowledgments  ManualAcknowledgment[]

  isActive        Boolean  @default(true)
  uploadedBy      String   // clerk user ID
  notes           String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model DocumentVersion {
  id              String   @id @default(cuid())
  documentId      String
  document        Document @relation(fields: [documentId], references: [id])
  version         String
  effectiveDate   DateTime
  fileUrl         String
  fileHash        String
  revisionNotes   String?
  uploadedBy      String
  archivedAt      DateTime @default(now())
}

model ManualAcknowledgment {
  id              String     @id @default(cuid())
  operatorId      String
  documentId      String
  document        Document   @relation(fields: [documentId], references: [id])
  crewMemberId    String
  crewMember      CrewMember @relation(fields: [crewMemberId], references: [id])

  documentVersion String     // version acknowledged
  documentHash    String     // hash of document at time of acknowledgment (legal record)
  acknowledgedAt  DateTime
  deviceType      String?    // "web" | "ios" | "android"
  ipAddress       String?    // for web acknowledgments

  // Crew must have viewed the document before acknowledging
  viewedAt        DateTime?
  viewDurationSeconds Int?
}
```

### E.3 — Revision Workflow

When a new document version is uploaded:
1. Previous version archived to `DocumentVersion`
2. New file hashed (SHA-256) and stored
3. If `requiresCrewAck` is true: all crew with matching roles have their acknowledgment status reset
4. Push notification sent to all affected crew
5. Crew blocked from accepting new trip assignments until acknowledged
6. Operator dashboard shows acknowledgment completion: "4 of 5 crew members acknowledged Rev 3.2"

---

## Module F: Flight Release System

Every Part 135 flight requires a flight release. This module manages the electronic release process, which must be completed before departure.

### F.1 — Flight Release Overview

The flight release is the operator's (or their designee's, the DOM/Director of Operations) formal authorization for a flight to depart. It confirms that all regulatory requirements have been met.

**Who can issue a release:**
- The operator/DOM
- A designated dispatcher (if operator has a dispatcher)
- In on-demand Part 135 without a dispatcher, the PIC and operator jointly confirm

**JetDeck release process:**
1. Operator completes the release checklist in JetDeck
2. PIC reviews and acknowledges from the crew app
3. Electronic release record generated with timestamp and signature equivalents
4. Release PDF stored on the trip record
5. Both operator and PIC copies available offline (cached on mobile)

### F.2 — Flight Release Checklist

Per trip leg, a release is required. Checklist is auto-generated from trip data.

**Aircraft section:**
- [ ] Aircraft is airworthy — no open AOG squawks
- [ ] All MEL deferred items within limits (list any active MEL items)
- [ ] Aircraft paperwork onboard: Airworthiness Certificate, Registration, Radio Station License, POH/AFM
- [ ] Aircraft fueled per flight plan requirements
- [ ] Current weight and balance computed (link to W&B record)

**Crew section:**
- [ ] PIC identified: [Name] — Certificate #[XXX]
- [ ] PIC medical current: Expires [Date]
- [ ] PIC instrument current: Last IPC [Date]
- [ ] SIC identified: [Name] (if applicable)
- [ ] SIC qualifications verified
- [ ] Crew rest requirements met: [hours available] / [hours required]
- [ ] Crew within flight time limits: [24hr: X.X / 8.0]
- [ ] All required training current

**Flight section:**
- [ ] Flight plan filed (ForeFlight — operator acknowledges completion)
- [ ] Weather reviewed for departure, en route, destination, alternate
- [ ] NOTAMs reviewed for departure, destination, alternate airports
- [ ] Destination airport suitable (hours, capabilities)
- [ ] Alternate airport designated (if required by conditions)
- [ ] Fuel planning complete: [X gallons required, X gallons planned]
- [ ] International requirements met (overflight permits, customs, immigration) — if applicable

**Passenger section:**
- [ ] Passenger manifest complete: [X passengers, total weight: X lbs]
- [ ] Hazmat screening complete (no prohibited items identified)
- [ ] Passengers briefed on safety procedures (PIC responsibility)

**Release signatures:**
- Operator/DOM: [Electronic signature] — [Timestamp]
- PIC acknowledgment: [Electronic signature from crew app] — [Timestamp]

### F.3 — Flight Release Data Model

```prisma
model FlightRelease {
  id              String   @id @default(cuid())
  operatorId      String
  tripId          String
  trip            Trip     @relation(fields: [tripId], references: [id])
  legNumber       Int      @default(1)

  // Checklist items stored as JSON for flexibility
  aircraftChecklist Json   // array of { item, completed, completedBy, note }
  crewChecklist     Json
  flightChecklist   Json
  passengerChecklist Json

  // Aircraft at time of release
  aircraftId      String
  aircraftHours   Float    // total time at release
  activeMelItems  Json?    // any active MEL deferrals at time of release

  // Crew at time of release
  picId           String
  sicId           String?
  picRestHours    Float    // rest hours available at release time
  picFlightHours24 Float  // 24-hour accumulator at release time
  picFlightHoursYTD Float // YTD accumulator at release time

  // W&B
  weightAndBalanceId String?

  // Fuel
  fuelRequired    Float?   // gallons
  fuelPlanned     Float?

  // Status
  status          String   @default("in_progress")
  // "in_progress" | "released" | "amended" | "cancelled"

  releasedAt      DateTime?
  releasedBy      String   // clerk user ID (operator/DOM)
  releasedByName  String

  picAcknowledgedAt DateTime?
  picAcknowledgedDevice String? // "ios" | "android" | "web"

  // Amendment
  amendedAt       DateTime?
  amendedBy       String?
  amendmentReason String?

  pdfUrl          String?  // generated release PDF
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

---

## Module G: Weight & Balance Calculator

Weight and balance must be computed for each Part 135 flight. JetDeck calculates it from manifest data and stores the result with the flight release.

### G.1 — Aircraft W&B Configuration

Each aircraft has its W&B envelope configured by the operator:

```prisma
model WeightBalanceConfig {
  id              String   @id @default(cuid())
  operatorId      String
  aircraftId      String   @unique
  aircraft        Aircraft @relation(fields: [aircraftId], references: [id])

  // Basic weight data
  basicEmptyWeight Float   // lbs
  basicEmptyArm    Float   // inches
  basicEmptyMoment Float   // calculated

  maxGrossWeight   Float   // lbs (MTOW)
  maxLandingWeight Float?  // lbs (if different)
  maxZeroFuelWeight Float? // lbs (if applicable)

  // CG envelope points (define the envelope polygon)
  envelopePoints   Json    // [{ weight: Float, forwardCG: Float, aftCG: Float }]

  // Fuel
  fuelType         String  // "Jet-A" | "100LL"
  fuelWeightPerGallon Float @default(6.7) // Jet-A standard
  fuelArmInches    Float   // fuel CG arm

  // Station definitions (seats, baggage)
  stations         Json    // [{ label, armInches, maxWeightLbs }]

  notes            String?
  configuredBy     String  // clerk user ID
  updatedAt        DateTime @updatedAt
}
```

### G.2 — W&B Calculation

```prisma
model WeightBalanceRecord {
  id              String   @id @default(cuid())
  operatorId      String
  tripId          String
  aircraft        String   // tail number
  legNumber       Int

  // Inputs
  fuelGallons     Float
  passengerWeights Json    // [{ seat, name, weightLbs }]
  baggageWeights   Json    // [{ location, weightLbs }]

  // Calculated results
  totalWeight     Float
  totalMoment     Float
  cgInches        Float
  cgPercent       Float?   // % MAC if configured

  // Compliance
  withinLimits    Boolean
  maxWeightResult String   // "pass" | "fail" | "warning"
  cgResult        String   // "pass" | "fail"
  notes           String?

  calculatedBy    String   // clerk user ID
  calculatedAt    DateTime @default(now())
  pdfUrl          String?
}
```

### G.3 — W&B Calculator UI

- Auto-populated with passenger weights from manifest
- Operator enters fuel load and baggage
- Real-time CG calculation with envelope graph displayed
- Green = within envelope, Red = outside envelope
- PDF report generated on completion
- Linked to flight release automatically

---

## Module H: Electronic Flight Logs

Complete electronic logbook maintained in JetDeck. Crew enter via mobile app, records are permanent and auditable.

### H.1 — Flight Log Entry

```prisma
model FlightLog {
  id              String   @id @default(cuid())
  operatorId      String
  tripId          String?
  tripLegId       String?
  aircraftId      String
  aircraft        Aircraft @relation(fields: [aircraftId], references: [id])

  // Crew
  picId           String
  pic             CrewMember @relation("FlightLogPIC", fields: [picId], references: [id])
  sicId           String?
  sic             CrewMember? @relation("FlightLogSIC", fields: [sicId], references: [id])

  // Route
  depAirport      String   // ICAO
  arrAirport      String   // ICAO
  depFBO          String?
  arrFBO          String?

  // Times (all stored as UTC, displayed in local time per airport)
  blockOutTime    DateTime
  takeoffTime     DateTime
  landingTime     DateTime
  blockInTime     DateTime

  // Calculated times
  flightHours     Float    // takeoff to landing
  blockHours      Float    // block out to block in

  // Currency-relevant data
  instrumentApproaches Json? // [{ type, airport, runway }]
  dayLandings     Int      @default(0)
  nightLandings   Int      @default(0)
  dayTakeoffs     Int      @default(0)
  nightTakeoffs   Int      @default(0)
  nightHours      Float    @default(0)
  actualIMC       Float    @default(0) // hours in actual instrument conditions
  simulatedIMC    Float    @default(0)

  // Passengers and fuel
  passengerCount  Int      @default(0)
  fuelUplift      Float?   // gallons at departure FBO

  // Irregularities
  irregularities  String?
  linkedSquawkIds String[] // discrepancy IDs reported during this flight

  // Review
  submittedAt     DateTime
  submittedBy     String   // clerk user ID (crew member)
  reviewedAt      DateTime?
  reviewedBy      String?  // operator/DOM review
  status          String   @default("submitted")
  // "submitted" | "reviewed" | "flagged" | "amended"

  amendmentReason String?
  notes           String?
  createdAt       DateTime @default(now())
}
```

### H.2 — Logbook Export

Crew can export their personal flight records from the crew portal:
- **ForeFlight CSV format** — imports directly into ForeFlight logbook
- **Garmin Pilot CSV format**
- **PRIA-compliant format** — for records requests
- **Standard logbook PDF** — print-ready

Operator can export all crew logs:
- Monthly flight time report per crew member
- Annual 1,200-hour limit compliance report
- PRIA records package for FAA requests

---

## Module I: Drug & Alcohol Program (DAAP)

Complete records management for Part 135 / 14 CFR Part 120 / 49 CFR Part 40 compliance.

**Important:** JetDeck records that testing occurred and the result. Actual specimen collection and lab processing is handled by the operator's designated Third-Party Administrator (C/TPA) or certified collection site. JetDeck is not a testing platform — it is a records platform.

### I.1 — Safety-Sensitive Employee Registry

```prisma
model DAAPEmployee {
  id              String   @id @default(cuid())
  operatorId      String
  crewMemberId    String?  @unique
  crewMember      CrewMember? @relation(fields: [crewMemberId], references: [id])

  // For non-crew safety-sensitive employees (ground handlers, etc.)
  firstName       String?
  lastName        String?
  email           String?

  // DAAP status
  isInRandomPool  Boolean  @default(true)
  enrolledAt      DateTime @default(now())
  removedAt       DateTime? // when employee departs or is removed from safety-sensitive duties
  removalReason   String?

  // Policy acknowledgment
  policyAcknowledgedAt DateTime?
  policyVersion   String?

  testRecords     DrugTestRecord[]
}
```

### I.2 — Test Records

```prisma
model DrugTestRecord {
  id              String      @id @default(cuid())
  operatorId      String
  employeeId      String
  employee        DAAPEmployee @relation(fields: [employeeId], references: [id])
  crewMemberId    String?
  crewMember      CrewMember? @relation(fields: [crewMemberId], references: [id])

  testType        String
  // "pre_employment"     — required before first safety-sensitive function
  // "random"             — DOT random selection
  // "post_accident"      — within 32 hours of qualifying accident
  // "reasonable_cause"   — supervisor-directed
  // "return_to_duty"     — after violation/refusal
  // "follow_up"          — after return-to-duty (minimum 6 tests in 12 months)

  substanceTested String     @default("both") // "drug" | "alcohol" | "both"

  // Test details (no lab data — just administrative record)
  testDate        DateTime
  collectionSite  String?
  ctoProviderName String?    // C/TPA name

  // Result (recorded after MRO review for drugs, at collection for alcohol)
  drugResult      String?    // "negative" | "positive" | "dilute_negative" | "cancelled" | "refusal"
  alcoholResult   String?    // "below_0.02" | "0.02_to_0.039" | "0.04_or_above" | "refusal"

  // If positive/refusal
  sacReferralDate DateTime?  // referral to Substance Abuse Counselor
  returnToWorkDate DateTime?

  // Documentation
  documentUrl     String?    // upload the MRO report (redacted if needed)
  notes           String?

  // Who recorded this
  recordedBy      String     // clerk user ID
  createdAt       DateTime   @default(now())
}
```

### I.3 — Random Testing Program

```prisma
model RandomTestingPool {
  id              String   @id @default(cuid())
  operatorId      String
  year            Int
  quarter         Int      // 1-4

  // DOT minimum rates (currently 25% for drugs, 10% for alcohol — verify annually)
  requiredDrugRate    Float  // e.g. 0.25
  requiredAlcoholRate Float  // e.g. 0.10
  poolSizeAtStart     Int    // number of employees at start of quarter
  requiredDrugTests   Int    // calculated: poolSize * rate / 4
  requiredAlcoholTests Int

  // Actual
  completedDrugTests   Int   @default(0)
  completedAlcoholTests Int  @default(0)

  // Selections
  selections      RandomSelection[]

  notes           String?
  createdAt       DateTime @default(now())
}

model RandomSelection {
  id              String          @id @default(cuid())
  poolId          String
  pool            RandomTestingPool @relation(fields: [poolId], references: [id])
  employeeId      String
  employee        DAAPEmployee    @relation(fields: [employeeId], references: [id])
  selectedDate    DateTime
  notifiedDate    DateTime?
  testRecordId    String?         // linked once test is completed
  status          String          @default("selected")
  // "selected" | "notified" | "completed" | "refused"
}
```

### I.4 — DAAP Dashboard

- Current random pool roster (who is enrolled)
- Q1/Q2/Q3/Q4 testing completion status vs. DOT requirements
- Employees with pending tests
- Employees in return-to-duty protocols
- Annual MIS report data (for DOT Management Information System submission)
- Policy acknowledgment status per employee
- Testing rate compliance: "Q3: 6 of 8 required drug tests complete"

### I.5 — Supervisor Training

DOT requires supervisors who may make reasonable-cause determinations to complete training.

```prisma
model SupervisorDAAP {
  id              String   @id @default(cuid())
  operatorId      String
  supervisorClerkId String  // clerk user ID of the supervisor
  supervisorName  String

  // Required training (49 CFR 40.67 / Part 120)
  drugTrainingDate     DateTime? // 60-minute drug signs/symptoms
  alcoholTrainingDate  DateTime? // 60-minute alcohol signs/symptoms
  trainingDocumentUrl  String?

  isQualified     Boolean  @default(false)
  notes           String?
  createdAt       DateTime @default(now())
}
```

---

## Module J: Availability & Scheduling

### J.1 — Crew Availability

```prisma
model CrewAvailability {
  id              String     @id @default(cuid())
  operatorId      String
  crewMemberId    String
  crewMember      CrewMember @relation(fields: [crewMemberId], references: [id])

  date            DateTime   // the date this applies to (date only)
  status          String
  // "available"    — crew is available and legal
  // "unavailable"  — crew has marked themselves unavailable
  // "vacation"     — approved vacation
  // "sick"         — sick day
  // "training"     — training event
  // "on_trip"      — assigned to a trip (auto-set)
  // "rest"         — in required rest period (auto-set from duty logs)

  reason          String?    // free text if unavailable
  approvedBy      String?    // clerk user ID if requires approval
  approvedAt      DateTime?

  createdAt       DateTime   @default(now())
  @@unique([crewMemberId, date])
}
```

### J.2 — Master Schedule View

A combined calendar showing:
- All aircraft (rows or swimlanes)
- All trips plotted as blocks across dates
- Crew assignments shown on trip blocks
- Maintenance windows shown in a different color
- Crew availability overlaid

**Filters:**
- By aircraft
- By crew member
- Date range (day / week / month)

**Color coding:**
- 🟦 Confirmed trip
- 🟧 Pending / needs attention
- 🟥 AOG / maintenance
- ⬜ Available
- 🟫 Crew unavailable / rest period

---

## Module K: Compliance Dashboard & Audit Trail

### K.1 — Compliance Dashboard

The operator's single-screen compliance health view. Answers: "Are we legal to operate right now?"

**Sections:**

**🚨 Immediate Attention (red):**
- Any crew member who has exceeded a flight time limit
- Any aircraft that is AOG
- Any MEL item that has exceeded its deferral period
- Any flight release not completed before scheduled departure
- Any random drug test overdue for the quarter

**⚠️ Requires Action Soon (yellow):**
- Crew certificates expiring within 60 days
- Training events due within 30 days
- MEL deferrals expiring within 7 days
- Aircraft maintenance due within 50 hours or 30 days
- PRIA incomplete for any PIC
- Manuals with unacknowledged crew

**✅ All Clear (green):**
- Each category shows "X items — all current"

**Quick stats:**
- Fleet: X aircraft, X active, X in maintenance
- Crew: X crew members, X available today, X on trip
- YTD flight hours per crew (vs. 1,200hr limit)
- Random testing: X of X required tests complete this quarter

### K.2 — Audit Trail

Every compliance action in JetDeck is logged permanently. The audit trail is non-deletable and non-editable.

```prisma
model AuditLog {
  id              String   @id @default(cuid())
  operatorId      String
  userId          String?  // clerk user ID (null for system actions)
  userName        String?
  userRole        String?

  // What happened
  action          String   // e.g. "flight_release.issued" | "discrepancy.created" | "mel_deferred"
  entityType      String   // "FlightRelease" | "Discrepancy" | "TrainingRecord" etc.
  entityId        String
  description     String   // human-readable description

  // Before/after for edits
  previousState   Json?
  newState        Json?

  // Context
  ipAddress       String?
  deviceType      String?  // "web" | "ios" | "android"
  sessionId       String?

  timestamp       DateTime @default(now())

  @@index([operatorId, timestamp])
  @@index([entityType, entityId])
}
```

**Audit events tracked:**
- All flight releases (issued, amended, cancelled)
- All discrepancy actions (created, classified, deferred, closed)
- All drug test records (created, amended)
- All training record changes
- All document uploads and revisions
- All crew acknowledgments
- All accumulator recalculations
- All compliance overrides (with reason)
- All crew assignment actions
- All aircraft status changes (AOG, return to service)

### K.3 — Compliance Reports

Available reports (exportable as PDF):

| Report | Purpose | FAA Reference |
|---|---|---|
| Crew Flight Time Report | Monthly/annual hours per crew | 135.63 |
| Crew Currency Report | Currency status all crew | 135.297/299 |
| Training Tracking Report | Due dates and completion history | 135.321 |
| Aircraft Discrepancy Log | All squawks, MEL items, resolutions | 135.61 |
| DAAP MIS Annual Report | Drug/alcohol testing statistics | 49 CFR 40 |
| PRIA Compliance Report | Records status for all PICs | PRIA |
| Manual Acknowledgment Report | Who has acknowledged what revision | Internal |
| Audit Trail Export | All compliance actions (date range) | 135.63 |
| Crew Roster | All active crew, certificates, qualifications | 135.95 |

---

## Ops Build Order — Steps 21 Through 55

Continue from Sales Phase 1 (Steps 1–20 complete). These are the operations and compliance steps.

**FOUNDATION (Steps 21–26)**

**Step 21: Database schema — all compliance models**
Add all new Prisma models in one migration: CrewMember (full), CrewQualification, CrewCertificate, CrewCurrency, FlightTimeAccumulator, TrainingRecord, PRIARecord, PRIAPreviousEmployer, AircraftCompliance, MaintenanceItem, Discrepancy, Document, DocumentVersion, ManualAcknowledgment, FlightLog, WeightBalanceConfig, WeightBalanceRecord, FlightRelease, ChecklistTemplate, ChecklistTemplateItem, TripChecklist, TripChecklistItem, CrewAvailability, TripCrew, Passenger, ManifestReminder, DAAPEmployee, DrugTestRecord, RandomTestingPool, RandomSelection, SupervisorDAAP, AuditLog.
This is a large migration — do it all at once to avoid cascading migration conflicts.

**Step 22: Audit logging middleware**
Build the AuditLog middleware before anything else — every subsequent step should automatically log its actions. Write a `logAction()` helper that all API routes call. This ensures the audit trail is complete from day one.

**Step 23: Crew roster — full profile**
Full CrewMember CRUD with all compliance fields. Certificate tracking. Qualification management. Photo/document uploads. Used by every subsequent module.

**Step 24: Aircraft compliance records**
AircraftCompliance record per aircraft. Certificate and registration tracking. Maintenance item entry (manual). CAMP import via CSV. Link to existing Aircraft model.

**Step 25: Document library — upload and management**
Document upload to Vercel Blob. Version control. Revision workflow. Manual acknowledgment requirement flagging. Operator-side management UI.

**Step 26: Expo mobile app — scaffolding**
Initialize Expo project (`npx create-expo-app@latest jetdeck-crew --template`). Install Clerk Expo SDK, Expo Router, expo-notifications, expo-secure-store. Set up EAS Build configuration. Implement Clerk auth on mobile. Confirm mobile app can authenticate and hit the Next.js API. This is the mobile foundation everything else builds on.

**CREW COMPLIANCE ENGINE (Steps 27–32)**

**Step 27: Flight time accumulator engine**
The compliance rules engine — the most critical piece. Build `lib/compliance/accumulators.ts`. Recalculates all rolling accumulators from raw FlightLog data on every log submission. Returns current state and limit comparisons. Write comprehensive unit tests (every Part 135 limit scenario). This must be accurate before anything else proceeds.

**Step 28: Pre-assignment availability check**
`lib/compliance/availability-check.ts` — runs all 8 checks before crew can be assigned. Returns AVAILABLE / CONDITIONAL / UNAVAILABLE with specific reasons. API route: `POST /api/compliance/crew-availability-check`. Used by the trip assignment UI.

**Step 29: Currency calculation engine**
`lib/compliance/currency.ts` — recalculates all CrewCurrency records when a FlightLog is submitted. Instrument approaches (6 in 6 months), day/night landings (3 in 90 days), night T/Os. Triggers alerts when currency is expiring.

**Step 30: Training due date engine**
`lib/compliance/training.ts` — calculates next due dates for all recurrent training items. IPC: 6 calendar months from last completion. Recurrent training: 12 calendar months. Creates alert records when items are approaching due.

**Step 31: Compliance dashboard — operator web view**
The operator-facing compliance health dashboard. Red/yellow/green sections. Aggregates data from all compliance engines. Refreshes in real time.

**Step 32: ComplianceAlert model and notification system**
When any compliance engine detects an issue, create a ComplianceAlert record. Route to: operator push/email notification, crew push notification (for their own alerts). Build the alert management UI (acknowledge, dismiss with reason).

**CREW PORTAL — WEB (Steps 33–38)**

**Step 33: Crew portal web — home dashboard**
Authenticated web view for crew members. Home screen showing next trip, flight time accumulators, currency status, upcoming training. Route group: `app/(crew)/`.

**Step 34: Crew portal web — trip view and acceptance**
My trips list. Trip detail view. Accept/decline workflow with compliance checks shown. Operator notified on response.

**Step 35: Crew portal web — duty time logging**
Start duty / end duty flow. Manual back-entry (up to 7 days). Duty period list. Rest period countdown.

**Step 36: Crew portal web — flight log entry**
Flight log entry form. All fields from Module H. Links to trip if assigned. Triggers accumulator recalculation on submit. Cross-reference with PIC/SIC if both log the same leg.

**Step 37: Crew portal web — currency and certificates**
Personal currency dashboard (read-only — calculated from logs). Certificate view. Upload certificate images. Training record view.

**Step 38: Crew portal web — manual acknowledgment**
Document library view for crew. PDF viewer. Acknowledge button. Track completion.

**CREW PORTAL — MOBILE (Steps 39–44)**

**Step 39: Mobile app — home dashboard**
Mirrors web home dashboard. Shows next trip, accumulators, currency status, alerts. Pull to refresh. Push notification setup.

**Step 40: Mobile app — trip list and acceptance**
My trips list (offline-cached). Trip detail. Accept/decline with compliance warnings. Push notification on new assignment.

**Step 41: Mobile app — duty time logging**
Start/end duty buttons. Offline-capable (stores locally, syncs when connected). Rest period countdown. Prominent remaining time display.

**Step 42: Mobile app — flight log entry**
Full flight log entry optimized for mobile. Offline entry with sync queue. Photo attachment for discrepancies.

**Step 43: Mobile app — discrepancy reporting**
Aircraft discrepancy entry from mobile. Photo upload. Severity selection. Immediate push to operator.

**Step 44: Mobile app — currency dashboard and manual acknowledgment**
Personal currency view. PDF viewer for manuals. Acknowledgment capture. Push notifications for expiring items.

**AIRCRAFT OPERATIONS (Steps 45–48)**

**Step 45: Discrepancy management — operator web**
Full discrepancy list and detail view. MEL deferral workflow (category, expiry, placard). AOG status trigger → aircraft blocked from quotes. Resolution and RTS workflow. Link to CAMP notes.

**Step 46: Weight and balance calculator**
Aircraft W&B configuration per aircraft (envelope, stations, empty weight). Calculator UI: auto-populated from manifest, fuel entry, baggage entry. CG envelope graph. Pass/fail. PDF generation. Link to flight release.

**Step 47: Pre-flight checklist — Part 135 enhanced**
Operator-configurable checklist templates. Auto-generated per trip from template. Crew checklist items viewable in mobile app. Required items gate "Released" status.

**Step 48: Passenger manifest — full system**
Token-based manifest collection page. Automated reminder sequence (72hr, 48hr, 24hr, 12hr). Per-passenger sub-tokens. Operator manifest view with progress. Manifest PDF download for flight release.

**FLIGHT RELEASE & COMPLIANCE (Steps 49–51)**

**Step 49: Flight release system**
Electronic flight release per leg. Auto-populated checklist from trip data, crew records, aircraft compliance. Operator completes and signs. PIC acknowledges from mobile app. Release PDF generated and stored. Status gating: trip cannot be marked "Released" without a complete signed release.

**Step 50: DAAP records management**
Safety-sensitive employee registry. Test record entry. Random pool management. Quarterly testing status. Supervisor training records. Annual MIS report data export.

**Step 51: PRIA tracking**
PRIA checklist per PIC. Previous employer request tracking. Record upload and storage. PIC blocked from PIC assignments until PRIA complete.

**REPORTING & AUDIT (Steps 52–55)**

**Step 52: Audit trail viewer**
Operator-facing audit log. Filterable by date, entity, user, action type. Non-editable. Exportable as PDF or CSV.

**Step 53: Compliance reports**
All reports listed in Module K.3. Exportable as PDF. Crew flight time, currency, training, discrepancy log, DAAP MIS, PRIA, manual acknowledgments, crew roster.

**Step 54: EAS build and app store submission**
Configure EAS Build for production. Build iOS and Android binaries. Submit to Apple App Store and Google Play Store. App Store review typically takes 1–7 days.

**Step 55: End-to-end compliance testing**
Full test pass: create a crew member, complete their records, assign to a trip, run through full flight release, log duty and flight time, verify accumulators update correctly, test all Part 135 limit scenarios, verify audit trail is complete. Fix any issues found.

---

## Data Architecture Notes

### Critical: Never delete compliance records
All flight logs, duty records, drug test records, release records, and audit logs are permanent. Use soft deletes (add `archivedAt` field) for operational records that need to be removed from active views. Hard deletes are prohibited for any record that has regulatory significance.

### Timezone handling
All times stored in UTC. Every time-stamped record that has operational significance (duty periods, flight logs, release signatures) also stores the local timezone at the time of recording. Display times in local time appropriate to the airport/location. Crew duty time calculations must handle multi-timezone operations correctly.

### Currency calculation correctness
The 6-month IPC currency window is **6 calendar months**, not 180 days. April 15 → October 15, not April 15 + 180 days. This distinction matters for the IPC currency engine. Implement this correctly — a pilot who is accidentally shown as current when they are not is a regulatory violation.

### Data separation: operator data vs crew personal data
Crew members can see their own compliance data. They cannot see other crew members' data, client names, financial information, or company-wide compliance reports. API routes for crew portal must enforce this at the query level, not just the UI level.

---

## What This Build Does NOT Include

Do not build in this phase:

- Full MRO / maintenance work order system (CAMP handles this)
- Payroll / crew pay calculation
- Part 119 certificate application management
- OpSpecs application workflow (handled with FAA directly)
- ASAP / SMS formal safety reporting program (Phase 3)
- ACARS / real-time flight tracking
- ATC communication logging
- International trip planning (customs, overflight permits — Phase 3)
- Simulator scheduling
- Crew scheduling optimization algorithm (Phase 3)

---

## How to Hand This to Claude Code

Open Claude Code with the Sales Brief (v5.0) and this Ops Brief (v2.0) and say:

> "JetDeck's sales pipeline is complete through Step 20. I now have a comprehensive Part 135 operations and compliance brief covering 35 additional build steps (Steps 21–55). Please read the Ops Brief v2.0 in full, then let's begin with Step 21: the full compliance database schema migration. This is a large migration with many related models — please review all the models in the brief before writing any code."

Store both briefs in the repo root. As modules are completed, mark steps done in the brief and commit the updated document.

---

*JetDeck Part 135 Ops Build Brief v2.0 — September 2026*
*Covers: Full Part 135 compliance suite — crew duty/flight time engine, crew portal (web + React Native mobile app), aircraft discrepancy management, document management with acknowledgment tracking, electronic flight release, weight and balance calculator, DAAP records, PRIA compliance, electronic flight logs, compliance dashboard, audit trail, and reporting.*
*35 build steps (Steps 21–55) following Sales Phase 1 Steps 1–20.*
*Regulatory references: 14 CFR Part 135, 14 CFR Part 120, 49 CFR Part 40.*
*Companion to: JetDeck Sales Build Brief v5.0*
