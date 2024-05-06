import {
  StreamableValue,
  createAI,
  createStreamableUI,
  createStreamableValue,
  getMutableAIState,
} from "ai/rsc";
import { CoreMessage } from "ai";

import Spinner from "@/components/Spinner";
import { Section } from "@/components/ai/code-gen/Section";
import { FollowupPanel } from "@/components/ai/code-gen/FollowupPanel";
import {
  requirementsManager,
  inquire,
  writer,
  aiSuggestor,
} from "@/lib/code-gen/agents";

async function submitUserInput(formData?: FormData, skip?: boolean) {
  "use server";

  const aiState = getMutableAIState<typeof AI>();
  const uiStream = createStreamableUI();
  const isGenerating = createStreamableValue(true);
  const isCollapsed = createStreamableValue(false);

  const messages: CoreMessage[] = aiState.get() as any;
  const maxMessages = 10;
  // Limit the number of messages to the maximum
  messages.splice(0, Math.max(messages.length - maxMessages, 0));
  // Get the user input from the form data
  const userInput = skip
    ? `{"action": "skip"}`
    : (formData?.get("input") as string);
  const content = skip
    ? userInput
    : formData
      ? JSON.stringify(Object.fromEntries(formData))
      : null;
  // Add the user message to the state
  if (content) {
    const message = { role: "user", content };
    messages.push(message as CoreMessage);
    aiState.update([...(aiState.get() as any), message]);
  }

  async function processEvents() {
    let action: any = { object: { next: "proceed" } };
    // If the user skips the task, we proceed to the search
    if (!skip) {
      action = (await requirementsManager(messages)) ?? action;
    }

    if (action.object.next === "inquire") {
      // Generate inquiry
      const inquiry = await inquire(uiStream, messages);

      uiStream.done();
      isGenerating.done();
      isCollapsed.done(false);
      aiState.done([
        ...aiState.get(),
        { role: "assistant", content: `inquiry: ${inquiry?.question}` },
      ]);
      return;
    }

    // Set the collapsed state to true
    isCollapsed.done(true);

    //  Generate the code
    let code = "";
    let toolOutputs = [];
    let errorOccurred = false;
    const codeStream = createStreamableValue<string>();

    uiStream.update(<Spinner message="Assistant thinking..." />);

    while (code.length === 0) {
      // Search blink KB and generate the code
      const { fullResponse, hasError, toolResponses } = await writer(
        uiStream,
        codeStream,
        messages,
      );
      code = fullResponse;
      toolOutputs = toolResponses;
      errorOccurred = hasError;
    }

    if (!errorOccurred) {
      // Generate related queries
      await aiSuggestor(uiStream, messages);

      // Add follow-up panel
      uiStream.append(
        <Section title="Follow-up">
          <FollowupPanel />
        </Section>,
      );
    }

    isGenerating.done(false);
    uiStream.done();
    aiState.done([...aiState.get(), { role: "assistant", content: code }]);
  }

  processEvents();

  return {
    id: Date.now(),
    isGenerating: isGenerating.value,
    component: uiStream.value,
    isCollapsed: isCollapsed.value,
  };
}

// Define the initial state of the AI. It can be any JSON object.
const initialAIState: {
  role: "user" | "assistant" | "system" | "function" | "tool";
  content: string;
  id?: string;
  name?: string;
}[] = [];

// The initial UI state that the client will keep track of, which contains the message IDs and their UI nodes.
const initialUIState: {
  id: number;
  isGenerating?: StreamableValue<boolean>;
  isCollapsed?: StreamableValue<boolean>;
  component: React.ReactNode;
}[] = [];

// AI is a provider you wrap your application with so you can access AI and UI state in your components.
export const AI = createAI({
  actions: {
    submitUserInput,
  },
  // Each state can be any shape of object, but for chat applications
  // it makes sense to have an array of messages. Or you may prefer something like { id: number, messages: Message[] }
  initialUIState,
  initialAIState,
});
