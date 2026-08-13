import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";

async function togglePaymentTerms(id: string, formData: FormData) {
  "use server";

  const operator = await getCurrentOperator();
  if (!operator) return;

  const contact = await prisma.contact.findFirst({
    where: { id, operatorId: operator.id },
  });
  if (!contact) return;

  const nextTerms = String(formData.get("nextTerms") ?? "standard");
  if (!["standard", "cash_on_account"].includes(nextTerms)) return;

  await prisma.contact.update({
    where: { id: contact.id },
    data: { paymentTerms: nextTerms },
  });
}

export default async function ContactsPage() {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  const contacts = await prisma.contact.findMany({
    where: { operatorId: operator.id },
    orderBy: { firstName: "asc" },
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
      <p className="mt-1 text-muted-foreground">
        Clients and brokers who&apos;ve requested a quote — created automatically as trip
        requests come in. Mark a trusted client as cash-on-account to waive the card hold
        requirement at booking time.
      </p>

      {contacts.length === 0 ? (
        <p className="mt-8 text-muted-foreground">
          No contacts yet — they&apos;re created automatically from trip requests.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Company</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Payment Terms</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const isCashOnAccount = c.paymentTerms === "cash_on_account";
                const toggleWithId = togglePaymentTerms.bind(null, c.id);
                return (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 font-medium">
                      {c.firstName} {c.lastName}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{c.company ?? "—"}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{c.email}</td>
                    <td className="py-3 pr-4 text-muted-foreground capitalize">{c.type}</td>
                    <td className="py-3 pr-4">
                      {isCashOnAccount ? (
                        <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
                          Cash on account
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Standard</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <form action={toggleWithId}>
                        <input
                          type="hidden"
                          name="nextTerms"
                          value={isCashOnAccount ? "standard" : "cash_on_account"}
                        />
                        <Button type="submit" variant="outline" size="sm">
                          {isCashOnAccount ? "Require card hold" : "Waive card hold"}
                        </Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
