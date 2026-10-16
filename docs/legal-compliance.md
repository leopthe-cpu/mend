# Legal and privacy compliance (research, 16 Oct 2026)

What Mend needs to comply with Canadian privacy, anti-spam and messaging
rules, plus what Twilio and Resend require, and a short first pass on the US.
It feeds the legal step of [launch-plan.md](launch-plan.md).

**This is research, not legal advice.** I'm not a lawyer. Each requirement
lists its source; items marked **(verify)** come from secondary sources or
from search summaries I couldn't check against the primary text (several
government and Twilio pages don't load from this sandbox). Have a Canadian
privacy lawyer review the final documents before real shops use Mend
(already on the list in `oz-todo.md`).

## 1. Who is responsible for what

Mend handles two kinds of personal information. The roles differ, so the
documents must say so.

| Data                                                                           | Whose customer | Mend's role                                        | Accountable under PIPEDA                                                                                                                    |
| ------------------------------------------------------------------------------ | -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Shop accounts: owner/staff name, email, sign-in, audit log                     | Mend's         | Organization that collects it                      | Mend                                                                                                                                        |
| Shop's end customers: name, phone, email, tickets, photos, passcodes, messages | The shop's     | Service provider ("processor") acting for the shop | The shop, which stays accountable for data it transfers to Mend; Mend must protect it by contract (PIPEDA principle 1 / OPC business guide) |

Consequences:

- The **shop** must get its customers' consent (the intake tick box) and
  answer their access requests. Mend must make that possible and say so in
  the terms.
- Mend needs a **Data Processing Addendum (DPA)** in its terms for shop data,
  just like Mend has with Resend (Resend's DPA, resend.com/legal/dpa).

## 2. Documents to produce

| #   | Document                                                                                                                                   | Public?                                  | Why                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| D1  | **Privacy policy** (`/privacy`)                                                                                                            | Yes                                      | PIPEDA openness principle; Quebec Law 25; Twilio toll-free verification requires it |
| D2  | **Terms of service** (`/terms`), including the SMS program terms and acceptable use                                                        | Yes                                      | Contract with shops; Twilio verification requires a terms URL                       |
| D3  | **Data Processing Addendum**, part of the terms                                                                                            | Yes                                      | Mend processes the shops' customer data (section 1)                                 |
| D4  | **Subprocessor list** (could be a section of D1)                                                                                           | Yes                                      | Cross-border notice (section 3.4); shops need to know where data goes               |
| D5  | **Privacy management notes**: privacy officer, breach register, retention schedule, access-request steps, Quebec privacy impact assessment | Internal (private, not this public repo) | PIPEDA accountability + breach records; Law 25 incident register and PIA            |
| D6  | **French versions** of D1–D3, only if Quebec shops are accepted                                                                            | Yes                                      | Charter of the French language s. 55 (section 3.5)                                  |

## 3. Canada: requirements checklist

### 3.1 PIPEDA (federal; applies in every province except for activity entirely within Alberta, BC or Quebec, which have their own laws, and to all cross-border data flows)

Source: OPC, [PIPEDA fair information principles](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/); [which law applies](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/r_o_p/02_05_d_26/).
Because Mend sends data across provincial and national borders (section 3.4),
PIPEDA applies to Mend wherever the shop is.

| Principle                          | Requirement                                                                                                                                                                                                                                                                      | Mend today                                                                                     | To do                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1 Accountability                   | Name a person responsible for compliance; protect data given to service providers by contract                                                                                                                                                                                    | Nobody named; vendor DPAs not reviewed                                                         | Name the privacy officer (Oz); accept/archive Supabase, Railway, Twilio, Resend DPAs; DPA for shops (D3)       |
| 2 Identifying purposes             | State why data is collected, at or before collection                                                                                                                                                                                                                             | Not stated                                                                                     | D1 lists each purpose                                                                                          |
| 3 Consent                          | Meaningful consent: what, with whom, why, risks of harm; re-consent for new purposes or new third parties ([OPC guidelines](https://www.priv.gc.ca/en/privacy-topics/business-privacy/collecting-personal-information/consent/gl_omc_201805/))                                   | Intake tick box stored with time and staff member (PR 8); no ToS/privacy acceptance at sign-up | Record ToS/privacy acceptance at sign-up (version + time); staff script for the intake question                |
| 4 Limiting collection              | Only what's needed                                                                                                                                                                                                                                                               | Fields are optional except name and description                                                | Keep; mention in D1                                                                                            |
| 5 Limit use, disclosure, retention | Keep only as long as needed                                                                                                                                                                                                                                                      | No retention rule (open in `oz-todo.md`)                                                       | Oz picks retention periods; build automatic deletion; D1 states them                                           |
| 6 Accuracy                         | Keep data accurate                                                                                                                                                                                                                                                               | Shops can edit customers                                                                       | Mention in D1                                                                                                  |
| 7 Safeguards                       | Security proportional to sensitivity                                                                                                                                                                                                                                             | RLS, encrypted phone/email/passcode, MFA option, audit log, security review                    | Summarize in D1; keep the security review private                                                              |
| 8 Openness                         | Policies readily available; name/title and address of the accountable person                                                                                                                                                                                                     | Placeholder pages                                                                              | D1 with privacy officer title and contact address                                                              |
| 9 Individual access                | Give people their data on request                                                                                                                                                                                                                                                | Shop data export exists (owner)                                                                | Steps for shops to answer a customer's request (export one customer); Mend answers requests about its own data |
| 10 Challenging compliance          | Complaint process                                                                                                                                                                                                                                                                | None                                                                                           | D1: how to complain to Mend, then to the OPC                                                                   |
| Breaches                           | Report to the OPC and notify people when there is a real risk of significant harm, as soon as feasible; **keep a record of every breach for 24 months** ([OPC](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/privacy-breaches-at-your-business/gd_pb_201810/)) | No process                                                                                     | Breach register + response steps in D5; Mend notifies affected shops without delay (in D3)                     |

### 3.2 Quebec, Law 25 (private sector act P-39.1). Applies if Quebec shops or customers are accepted

Sources: CAI, [main changes of Law 25](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25); [Act P-39.1](https://legisquebec.gouv.qc.ca/en/showdoc/cs/p-39.1).

| Requirement                                                                                                                                                                                                                 | To do                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Person in charge of personal information; title and contact published on the website                                                                                                                                        | In D1 and the site footer                                                                              |
| Privacy policy in clear, simple terms, published, with notice of changes                                                                                                                                                    | D1 + email shops on changes                                                                            |
| **Privacy impact assessment before sending data outside Quebec** (s. 17), plus a written agreement. Supabase is in Canada (ca-central-1, which I believe is in Montreal (verify)); Railway, Twilio and Resend are in the US | Written PIA in D5 per vendor; vendor DPAs as the written agreements                                    |
| PIA for a new or overhauled system handling personal information (s. 3.3)                                                                                                                                                   | One PIA for Mend itself in D5                                                                          |
| **Incident register**, kept at least 5 years; risk assessment; notify the CAI and people when there is a risk of serious injury                                                                                             | Same register as PIPEDA, kept 5 years                                                                  |
| Highest privacy settings by default                                                                                                                                                                                         | Check: nothing is shared or public by default (I believe this already holds (verify during the build)) |
| **Data portability** (since 22 Sep 2024): give a person's data in a structured, common format on request                                                                                                                    | Per-customer export (JSON/CSV) for shops                                                               |
| Penalties up to $10M or 2% of worldwide turnover                                                                                                                                                                            | —                                                                                                      |

### 3.3 CASL (Canada's Anti-Spam Legislation): texts and emails to customers

Sources: CRTC, [CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm), [information session](https://www.crtc.gc.ca/eng/com500/info.htm); ISED, [Texting for good client relations](https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en/texting-good-client-relations).

- A commercial electronic message needs **consent, sender identification and
  an unsubscribe mechanism**.
- Section 6(6) exempts some messages from the **consent** rule: messages that
  complete or confirm a transaction, or give factual information about an
  ongoing purchase. "Your coat is ready" probably fits. **Sources conflict**
  on whether identification and unsubscribe still apply, and on whether such
  messages are commercial at all (verify with the lawyer). Safe approach:
  treat them as needing identification and unsubscribe anyway.
- **Identification:** the sender's name plus a mailing address and one
  contact method, valid 60 days after sending. In an SMS this can be a link to
  a page with the details (verify the exact CRTC rule).
- **Unsubscribe:** free, readily performed (SMS: reply STOP; email: a clear
  link); honoured within **10 business days**. Mend honours STOP right away.
- **Express consent** doesn't expire but can be withdrawn at any time.
- Mend is only a tool, but both the shop (sender) and Mend can be named as
  people who play a role. The ToS must make shops responsible for consent.

Gaps in Mend today:

- No "Reply STOP to opt out" in texts. Twilio also wants opt-out
  instructions in the first message (section 4.1).
- Emails have no unsubscribe line (decision 49 chose no footer). **Decision
  needed:** add a short footer with the shop's details and an unsubscribe
  link.
- The shop address is optional, but CASL identification needs it (or a page
  that shows it).
- **Is a pre-ticked intake box valid express consent?** For truly transactional
  6(6) messages consent may not be needed at all. If consent is needed, a
  default-on box recorded by staff is weak evidence. I don't have a verified
  source for the CRTC's position on pre-checked boxes. **Ask the lawyer.**

### 3.4 Cross-border processing (US vendors)

Source: OPC, [Guidelines for processing personal data across borders](https://www.priv.gc.ca/en/privacy-topics/airports-and-borders/gl_dab_090127/) (still the current position per the [2019 announcement](https://www.priv.gc.ca/en/opc-news/news-and-announcements/2019/an_190923/)).

- Tell people, in plain language and ideally at collection, that their data
  may be processed in another country and may be accessible to that
  country's courts, law enforcement and national security authorities.
- Contracts must protect the data, though they can't override foreign law.
- Separate consent is generally not needed when the transfer is integral to
  the service (OPC finding 2020-001). **Sources differ**, so ask the lawyer.

Where Mend's data goes:

| Vendor   | Purpose                                  | Location                                  | Contract                                                                                                                                                                                      |
| -------- | ---------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase | Database, sign-in, files, functions      | Canada (ca-central-1)                     | Supabase DPA (verify how to accept it on our plan)                                                                                                                                            |
| Railway  | Runs the web app; data passes through it | US (deploy region `iad`, seen in Railway) | Railway DPA (verify)                                                                                                                                                                          |
| Twilio   | Text messages                            | US                                        | Twilio DPA (verify) + [Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy)                                                                                                 |
| Resend   | Emails (sign-up and customer)            | US                                        | [Resend DPA](https://resend.com/legal/dpa), in force automatically for every account; [subprocessors](https://resend.com/legal/subprocessors); [AUP](https://resend.com/legal/acceptable-use) |

### 3.5 French language (Quebec only)

Source: [Charter of the French language](https://www.legisquebec.gouv.qc.ca/en/document/cs/c-11), s. 55; [Regulation C-11, r. 9](https://www.legisquebec.gouv.qc.ca/fr/document/rc/c-11,%20r.%209?langCont=en), s. 27.3.

- Standard-form contracts (contracts of adhesion) must be given in French
  first. For online contracts, giving the standard clauses in French meets
  that rule. A non-French version binds only if the French version was
  provided first and the party asked for the other language.
- So **Quebec shops need French terms**. I found no source confirming whether
  the privacy policy must also be in French (verify).
- **Recommendation:** don't accept Quebec shops at launch (state it in the
  terms and in sign-up). Do French later. That removes D6 and most of
  section 3.2 for now, though Law 25 may still reach Quebec residents who are
  customers of out-of-province shops (verify).

### 3.6 Other provinces

Alberta and BC have their own Personal Information Protection Acts (PIPA),
deemed substantially similar to PIPEDA, for activity entirely within those
provinces. Mend's cross-border flows keep PIPEDA in play, and the OPC
principles above cover the common ground. Ask the lawyer whether anything
Alberta- or BC-specific applies (e.g. Alberta's breach notification rules (verify)).

## 4. What Twilio and Resend require

### 4.1 Twilio toll-free verification and messaging policy

Sources: [verification now requires privacy policy and terms](https://www.twilio.com/en-us/changelog/toll-free-verification-now-requires-privacy-policy-and-terms-and), [error 30520](https://www.twilio.com/docs/api/errors/30520), [error 30519](https://www.twilio.com/docs/api/errors/30519), [error 30446](https://www.twilio.com/docs/api/errors/30446), [onboarding guide](https://support.twilio.com/hc/en-us/articles/13264118705051-Toll-Free-Verification-Onboarding-Guide), [Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy).

**Blocking for the Twilio submission:**

- Since **15 Sep 2026**, every new toll-free verification **must include a
  privacy policy URL and a terms URL**. Without them it is rejected.
- Both pages must load **without logging in**.
- The URLs must **match** what's shown where people opt in.
- The privacy policy must state that **text-messaging opt-in data and consent
  are never shared with third parties**. If it mentions any data sharing,
  the onboarding guide asks for a verbatim clause: _"All the above categories
  exclude text messaging originator opt-in data and consent; this information
  won't be shared with any third parties."_ Wording varies between Twilio
  pages, so copy it from the form at submission time.
- Any wording that suggests selling, renting or sharing data with marketing
  partners or affiliates gets rejected (30520, 30477).
- Mentioning "SMS" in the terms is **not** consent (30446). The opt-in itself
  must be shown. Ours is verbal and in person, recorded by staff in the
  intake tick box, so the submission must describe that flow (and possibly
  include a screenshot of the tick box (verify the field options in the
  form)).

**Ongoing rules:**

- The recipient knows who is sending and what they'll get, and how to stop.
- The first message includes opt-out instructions.
- Opting out is a single step; one confirmation is allowed, then nothing.
- Resuming requires new consent.
- For US/Canada, the standard "message and data rates may apply" disclosure
  goes with the opt-in.
- Twilio handles STOP/START keywords on toll-free numbers by default
  (STOP, and since April 2025 also REVOKE and OPTOUT).

### 4.2 Resend

- The DPA applies automatically. Data is deleted within 90 days of account
  closure.
- Customer emails must follow Resend's Acceptable Use Policy.
- Bounces and complaints already reach Mend (resend-webhook).

## 5. United States: first pass (after Canada)

| Law                   | Applies to Mend?      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TCPA** (FCC) texts  | Yes, for US customers | Informational texts need the recipient's prior express consent. Consent can be withdrawn by **any reasonable means** (STOP, "cancel", saying so in the shop), honoured within **10 business days**; a STOP to an informational text may be read as covering that category only ([FCC 24-24](https://docs.fcc.gov/public/attachments/FCC-24-24A1.pdf), [DA 25-312](https://docs.fcc.gov/public/attachments/DA-25-312A1.pdf)). Staff can already mark a customer opted out. Some states have their own "mini-TCPA" rules (verify which). |
| **CAN-SPAM** emails   | Mostly no             | Purely transactional emails are exempt from most rules, but subject lines and opening content must stay transactional ([FTC guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)).                                                                                                                                                                                                                                                                                                           |
| **CCPA** (California) | Not now               | Applies above **$26.625M** revenue (2025 figure), 100,000+ consumers/households, or 50%+ revenue from selling data ([CPPA](https://cppa.ca.gov/regulations/cpi_adjustment.html)). Other states' privacy laws have similar size thresholds (verify each before US launch).                                                                                                                                                                                                                                                              |
| Breach notification   | Yes                   | Every US state has a breach notification law with its own rules (verify the list before US launch).                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 6. What goes into each document

**D1 Privacy policy:**

- Who Mend is: legal name, address, privacy officer title and contact.
- The two roles from section 1.
- What is collected, for shop users and for shop customers (on the shop's
  behalf).
- The purposes.
- Consent, and how to withdraw it.
- The subprocessor table and the cross-border notice.
- The Twilio non-sharing clause, verbatim.
- No selling or renting of data, ever.
- Retention periods.
- Safeguards, in summary.
- Rights: access, correction, withdrawal, portability (if Quebec).
- How to complain (Mend first, then the OPC, or the CAI in Quebec).
- Breach handling.
- Cookies and local storage: sign-in session only, plus one display
  preference. No analytics or ad trackers today.
- Not for children.
- Changes, and how shops are notified.
- Effective date.

**D2 Terms of service:**

- Parties.
- The service.
- Accounts and security; Owner responsibilities.
- **Shop duties:**
  - get customers' consent and record it;
  - only send transactional messages (no promotions);
  - follow CASL, TCPA, the Twilio Messaging Policy and the Resend AUP;
  - don't put card numbers or health data in notes;
  - keep the shop's address up to date (CASL identification).
- Acceptable use.
- **SMS program terms:**
  - program name and description (repair-status texts from the shop);
  - message frequency varies;
  - message and data rates may apply;
  - reply STOP to stop, HELP for help;
  - support contact;
  - carriers are not liable for delayed or undelivered messages.
- Fees and billing (when pricing exists).
- Data ownership: the shop owns its customer data.
- The DPA (D3).
- Export and deletion (already built, decision 58).
- Suspension and termination.
- Disclaimers and limitation of liability.
- Indemnity: the shop covers messages it sends without consent.
- Governing law (Oz's province).
- Changes to the terms, with notice.
- Not offered in Quebec for now (decision 73).
- Contact.

**D3 DPA:**

- Mend acts only on the shop's instructions.
- Confidentiality and security measures.
- Subprocessors, with notice of changes.
- Mend helps the shop answer access, correction and portability requests.
- Breach notice to the shop without undue delay.
- Deletion or return of data at the end.
- Cross-border transfers.

## 7. Product changes these rules need

Each is a separate PR, with tests, after the documents exist.

1. **Real `/privacy` and `/terms` pages**, with version and effective date.
   Footer links already exist.
2. **Sign-up:** "I agree to the Terms and Privacy policy" box. Store the
   version and time per user. Re-ask when the terms change.
3. **SMS opt-out text:** add "Reply STOP to opt out" to the first text a
   customer gets from a shop, or to every text (decide). Configure the HELP
   reply (shop name plus a contact).
4. **Email footer:** shop name, address, and a one-click unsubscribe that
   sets `email_opted_out`. This amends decision 49.
5. **Shop address required** before the first message is sent (CASL
   identification).
6. **Intake consent wording:**
   - the label states what the customer is agreeing to;
   - a staff script;
   - the default (ticked or unticked) per the lawyer's answer.
7. **Retention:** automatic deletion of closed tickets, photos and messages
   after the periods Oz chooses.
8. **Per-customer export** (access and portability) for shops.
9. **Privacy officer contact** on the site.
10. **Subprocessor list** page (or a section in the privacy policy).
11. **Quebec:** block or allow at sign-up, per decision. If allowed, French
    versions.

## 8. What I need from Oz

- Legal business name, type (sole proprietor or corporation), mailing
  address, and **business registration number** (pre-launch to-dos in
  `oz-todo.md`; to start, sole proprietor under Oz's own name). Twilio requires the number
  for toll-free verification since Feb 2026 unless you're a sole proprietor
  (docs/verification.md T1).
- ~~Province~~: **Ontario** (decided 16 Oct, decision 73).
- Privacy officer: Oz. Contact email: to be set up (pre-launch to-do).
- ~~Quebec at launch~~: **no** (decided 16 Oct, decision 73), so D6 and
  most of §3.2 are deferred.
- Retention periods for closed tickets, photos and messages.
- Pricing, or "free during beta", for the fees section.
- A lawyer for the final review, and the questions flagged above:
  - pre-ticked box;
  - 6(6) and unsubscribe;
  - cross-border consent;
  - Alberta/BC specifics.
  - whether a STOP reply to a text must also stop emails from that shop
    (decision 77 keeps emails on).
