import { ContactsPage } from "@/components/contacts-page";

export function generateStaticParams() {
  return [{ pubky: [] }];
}

export default function ContactsRoute() {
  return <ContactsPage />;
}
