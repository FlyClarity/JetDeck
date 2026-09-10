import Link from "next/link";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";

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
        requests come in. Click into a contact to manage their information and payment terms.
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
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const isCashOnAccount = c.paymentTerms === "cash_on_account";
                return (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4">
                      <Link
                        href={`/contacts/${c.id}`}
                        className="font-medium hover:underline hover:underline-offset-4"
                      >
                        {c.firstName} {c.lastName}
                      </Link>
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
