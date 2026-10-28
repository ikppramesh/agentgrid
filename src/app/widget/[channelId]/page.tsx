import { ChatWidget } from "./widget";

export default async function WidgetPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  return <ChatWidget channelId={channelId} />;
}
