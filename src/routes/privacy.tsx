import { createFileRoute } from "@tanstack/react-router";

import { LegalContact, LegalPage } from "@/components/site/LegalPage";
import { LEGAL, SUBPROCESSORS, TWILIO_OPT_IN_CLAUSE } from "@/lib/legal";

// Interim privacy policy (launch-plan.md L1a): enough for Twilio's toll-free
// verification and for PIPEDA openness while the full policy is drafted and
// reviewed by a lawyer (docs/legal-compliance.md §2 D1). Keep every statement
// true of the product as built.
export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy policy · Mend" }] }),
  component: Page,
});

function Page() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        Mend is software that repair shops use to track repair tickets and to keep their customers
        updated by text message and email. This policy explains what personal information Mend
        handles, why, and the choices you have. Mend is operated by {LEGAL.operator} in{" "}
        {LEGAL.province}, Canada.
      </p>

      <h2>Two kinds of information</h2>
      <ul>
        <li>
          <strong>Shop accounts.</strong> When a shop owner or staff member signs up, Mend collects
          their name, email address, sign-in details and a record of actions taken in the shop's
          account. Mend is responsible for this information.
        </li>
        <li>
          <strong>Shop contact pages.</strong> Each shop's name, address, phone, email and hours are
          shown on a public page linked from its texts, so customers know who is texting them.
        </li>
        <li>
          <strong>Shops' customers.</strong> A shop enters its customers' names, phone numbers,
          email addresses, repair details, photos and messages. Mend stores and processes this
          information for the shop, which decides what to collect and stays responsible for it. To
          see, correct or delete it, contact the shop first; we will help the shop answer.
        </li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To run the service: tickets, estimates, invoices, payments records and photos.</li>
        <li>
          To send the repair updates a shop chooses to send, such as "your item is ready", by text
          or email.
        </li>
        <li>To keep accounts secure, prevent abuse and keep an audit log for the shop.</li>
        <li>To answer support questions.</li>
      </ul>
      <p>
        We do not sell, rent or trade personal information, and we do not use it for advertising.
      </p>

      <h2>Text messages</h2>
      <p>
        A shop texts a customer only after the customer agrees, usually in person when they drop off
        an item; the shop records that agreement on the ticket. Messages are about the customer's
        own repair (for example: ticket created, ready for pickup, reminders). Message frequency
        varies. Message and data rates may apply. Reply STOP to stop receiving texts from that shop,
        or HELP for help; you can also ask the shop to stop.
      </p>
      <p>
        Phone numbers and text-message consent are used only to send these updates. They are never
        shared with third parties or affiliates for marketing or promotional purposes.{" "}
        {TWILIO_OPT_IN_CLAUSE}
      </p>

      <h2>Service providers and where information is stored</h2>
      <p>
        Mend uses these service providers to run the service. They may process personal information
        only to provide their service to Mend:
      </p>
      <ul>
        {SUBPROCESSORS.map((s) => (
          <li key={s.name}>
            {s.name}: {s.purpose.toLowerCase()} ({s.location})
          </li>
        ))}
      </ul>
      <p>
        The database is in Canada. Some information is processed in the United States by the
        providers above, and while it is there it may be accessed by the courts, law enforcement and
        national security authorities of the United States.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Information stays in a shop's account until the shop deletes it or closes its account; when
        a shop deletes its account, its data is deleted. Retention periods for closed tickets,
        photos and messages will be added to this policy before launch.
      </p>

      <h2>How we protect it</h2>
      <p>
        Access is limited to the shop's own team, by role. Phone numbers, email addresses and device
        passcodes are encrypted in the database. Two-step sign-in is available. No method is
        perfectly secure; if a breach creates a real risk of significant harm, we will notify the
        affected shops and people and report it to the Privacy Commissioner of Canada, as the law
        requires.
      </p>

      <h2>Cookies and similar technology</h2>
      <p>
        Mend stores your sign-in session and one display preference in your browser. It uses no
        advertising or analytics trackers.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Ask for access to, or correction of, your information.</li>
        <li>Withdraw consent to texts (reply STOP) or emails (ask the shop) at any time.</li>
        <li>
          If you are not satisfied with our answer, you can complain to the Office of the Privacy
          Commissioner of Canada.
        </li>
      </ul>
      <p>Mend is for businesses and is not directed at children.</p>

      <h2>Changes</h2>
      <p>
        We will post any changes here with a new effective date, and tell shops by email about
        significant ones.
      </p>

      <h2>Contact</h2>
      <LegalContact />
    </LegalPage>
  );
}
