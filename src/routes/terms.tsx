import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalContact, LegalPage } from "@/components/site/LegalPage";
import { LEGAL } from "@/lib/legal";

// Interim terms of service (launch-plan.md L1a): the shop's duties, the SMS
// program terms Twilio's toll-free verification looks for, and the basics,
// until the full terms and DPA are drafted and reviewed by a lawyer
// (docs/legal-compliance.md §2 D2, D3). Ontario law, not offered in Quebec
// (decision 73).
export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of service · Mend" }] }),
  component: Page,
});

function Page() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms apply to repair shops that use Mend ("you"). Mend is operated by{" "}
        {LEGAL.operator} in {LEGAL.province}, Canada ("we"). By creating an account you agree to
        them. Mend is currently offered in Canada outside Quebec and in the United States.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>The person who creates the shop is its owner and manages who has access.</li>
        <li>Keep sign-in details secure and tell us about any unauthorized use.</li>
        <li>You are responsible for what your team does in your account.</li>
      </ul>

      <h2>Your customers' information</h2>
      <ul>
        <li>
          You own the information you enter about your customers. We process it for you as described
          in the <Link to="/privacy">privacy policy</Link>, and only to provide the service.
        </li>
        <li>
          You are responsible for having a valid reason and, where needed, consent to collect it,
          and for answering your customers' requests to see, correct or delete it. Mend gives you
          the tools to do so, including a full export and account deletion.
        </li>
        <li>Do not enter payment card numbers or health information in notes or fields.</li>
      </ul>

      <h2>Text messages and emails</h2>
      <p>
        Mend lets you send your customers updates about their own repairs, by text message and
        email, from Mend's shared number and email service.
      </p>
      <ul>
        <li>
          Text a customer only after they agree, and record that agreement on the ticket (the "Send
          updates" box when creating a ticket).
        </li>
        <li>
          Send only messages about the customer's own ticket, such as ticket created, ready for
          pickup and reminders. No promotional or marketing messages.
        </li>
        <li>
          Respect opt-outs. Customers can reply STOP at any time; Mend then stops texting them for
          your shop. If a customer asks you in person to stop, mark them as opted out.
        </li>
        <li>
          Follow the laws that apply to your messages, including Canada's Anti-Spam Legislation and,
          in the United States, the Telephone Consumer Protection Act, and the rules of our
          messaging providers: the{" "}
          <a href="https://www.twilio.com/en-us/legal/messaging-policy">Twilio Messaging Policy</a>{" "}
          and the <a href="https://resend.com/legal/acceptable-use">Resend Acceptable Use Policy</a>
          .
        </li>
        <li>
          Keep your shop's name, address and phone up to date; they identify you as the sender. They
          are shown on your shop's public contact page, which Mend links from the first text each
          customer receives. Texts can't be sent until both are filled in.
        </li>
      </ul>

      <h2>Text message program terms (for your customers)</h2>
      <ul>
        <li>
          Program: repair-status text messages from the shop that holds your item, sent through
          Mend.
        </li>
        <li>You receive them only after agreeing to updates when your ticket is created.</li>
        <li>Message frequency varies with your repair, usually a few messages per ticket.</li>
        <li>Message and data rates may apply.</li>
        <li>Reply STOP to opt out. Reply HELP for help, or contact the shop or us (below).</li>
        <li>Carriers are not liable for delayed or undelivered messages.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Do not use Mend to break the law, to send spam, to harass anyone, to access other shops'
        data, or to disrupt or reverse-engineer the service.
      </p>

      <h2>The service</h2>
      <p>
        Mend is provided "as is" while it is in early access. We work to keep it available and your
        data safe, but we do not guarantee it will be uninterrupted or error-free. To the extent the
        law allows, we are not liable for indirect or consequential losses, and our total liability
        is limited to the amount you paid us in the 12 months before the claim.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can export your data and delete your shop at any time from Settings. We may suspend
        accounts that break these terms, with notice where reasonable.
      </p>

      <h2>Changes and law</h2>
      <p>
        We will post changes here with a new effective date and tell shops by email about
        significant ones. These terms are governed by the laws of {LEGAL.province} and the federal
        laws of Canada that apply there.
      </p>

      <h2>Contact</h2>
      <LegalContact />
    </LegalPage>
  );
}
