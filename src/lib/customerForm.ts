import { friendlyDbError } from "./shop";
import { getSupabase } from "./supabase";
import { fetchContacts } from "./tickets";

// The customer's editable details, shared by the customer page and the
// "edit customer" dialog on the ticket page (decision 100), so both load and
// save the same way (public.save_customer: same checks, same audit entry).

export type CustomerFormValues = {
  name: string;
  phone: string;
  email: string;
  channel: "sms" | "email";
  notes: string;
};

export async function loadCustomerForm(
  customerId: string,
): Promise<{ values: CustomerFormValues } | { error: string }> {
  const { data, error } = await getSupabase()
    .from("customers")
    .select("id, name, preferred_channel, notes")
    .eq("id", customerId)
    .maybeSingle();
  if (error || !data) return { error: error ? friendlyDbError(error) : "Customer not found." };
  const contact = (await fetchContacts([customerId])).get(customerId);
  return {
    values: {
      name: data.name as string,
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      channel: data.preferred_channel as "sms" | "email",
      notes: (data.notes as string | null) ?? "",
    },
  };
}

/** Returns an error message to show, or null when saved. */
export async function saveCustomerForm(
  shopId: string,
  customerId: string,
  v: CustomerFormValues,
): Promise<string | null> {
  const { error } = await getSupabase().rpc("save_customer", {
    p_shop_id: shopId,
    p_customer_id: customerId,
    p_name: v.name,
    p_phone: v.phone || null,
    p_email: v.email || null,
    p_preferred_channel: v.channel,
    p_notes: v.notes || null,
  });
  return error ? friendlyDbError(error) : null;
}
