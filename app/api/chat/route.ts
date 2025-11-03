import { NextRequest } from 'next/server';
import { getAssistant } from '@/lib/pinecone';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    const assistantName = process.env.PINECONE_ASSISTANT_NAME;

    if (!assistantName) {
      return new Response(
        JSON.stringify({ error: 'Missing PINECONE_ASSISTANT_NAME' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const assistant = getAssistant(assistantName);

    // Sanitize messages to only include 'role' and 'content' (required by SDK)
    // The SDK rejects messages with extra properties like 'citations'
    const sanitizedMessages = messages.map((msg: any) => ({
      role: msg.role,
      content: msg.content,
    }));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Use SDK's chatStream method
          const chatStream = await assistant.chatStream({
              messages: sanitizedMessages,
              model: 'gpt-4.1',
          });

          // Handle the stream from SDK - it returns objects directly
          let streamEnded = false;
          for await (const response of chatStream) {
            if (response) {
              try {
                // SDK should return objects, but handle string case as fallback
                // Type response as unknown first to allow type narrowing
                const responseValue: unknown = response;
                let data: any;
                if (typeof responseValue === 'string') {
                  data = JSON.parse(responseValue.replace(/^data:\s*/, '').trim());
                } else {
                  data = responseValue;
                }

                if (!data) continue;

                // Transform to match expected format
                let transformedData: any;
                switch (data.type) {
                  case 'message_start':
                    transformedData = {
                      type: 'message_start',
                      id: data.id,
                      model: data.model,
                      role: data.role,
                    };
                    break;
                  case 'content_chunk':
                    transformedData = {
                      type: 'content_chunk',
                      delta: { content: data.delta?.content || data.content || '' },
                    };
                    break;
                  case 'citation':
                    transformedData = {
                      type: 'citation',
                      citation: data.citation,
                    };
                    break;
                  case 'message_end':
                    transformedData = {
                      type: 'message_end',
                      finish_reason: data.finish_reason,
                      usage: data.usage,
                    };
                    streamEnded = true;
                    break;
                  default:
                    // Pass through unknown types
                    transformedData = data;
                }

                // Only enqueue if controller is not closed
                try {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(transformedData)}\n\n`)
                  );
                } catch (enqueueError: any) {
                  // Controller might be closed, which is fine if stream ended
                  if (enqueueError.code !== 'ERR_INVALID_STATE' || !streamEnded) {
                    throw enqueueError;
                  }
                  // If controller is closed and stream ended, we can safely break
                  break;
                }

                // Close controller after message_end is sent
                if (streamEnded) {
                  try {
                    controller.close();
                  } catch (closeError: any) {
                    // Controller might already be closed, which is fine
                    if (closeError.code !== 'ERR_INVALID_STATE') {
                      throw closeError;
                    }
                  }
                  return;
                }
              } catch (error) {
                console.error('Error processing chunk:', error, response);
              }
            }
          }

          // If stream ends without message_end, close controller
          if (!streamEnded) {
            try {
              controller.close();
            } catch (closeError: any) {
              // Controller might already be closed, which is fine
              if (closeError.code !== 'ERR_INVALID_STATE') {
                throw closeError;
              }
            }
          }
        } catch (error: any) {
          console.error('Stream error:', error);
          
          // Extract error message from Pinecone errors
          let errorMessage = 'An error occurred';
          if (error?.message) {
            try {
              // Try to parse nested error messages from Pinecone
              let parsed = typeof error.message === 'string' ? JSON.parse(error.message) : error.message;
              
              // Handle nested error structures (Pinecone errors can have multiple levels)
              while (parsed && typeof parsed === 'object') {
                if (parsed.error?.message) {
                  // Check if error.message is itself a JSON string
                  try {
                    const innerParsed = typeof parsed.error.message === 'string' 
                      ? JSON.parse(parsed.error.message) 
                      : parsed.error.message;
                    if (innerParsed?.error?.message) {
                      parsed = innerParsed;
                      continue;
                    }
                  } catch {
                    // Not nested JSON, use it directly
                  }
                  errorMessage = parsed.error.message;
                  break;
                } else if (parsed.message) {
                  errorMessage = parsed.message;
                  break;
                } else if (typeof parsed.error === 'string') {
                  errorMessage = parsed.error;
                  break;
                } else {
                  errorMessage = error.message;
                  break;
                }
              }
              
              if (errorMessage === 'An error occurred' && error.message) {
                errorMessage = error.message;
              }
            } catch {
              errorMessage = error.message || 'An error occurred';
            }
          }
          
          // Send error event via SSE before closing
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\n`)
            );
          } catch (e: any) {
            // Controller might be closed, log but don't throw
            if (e.code !== 'ERR_INVALID_STATE') {
              console.error('Error sending error event:', e);
            }
          }
          
          // Close controller, but handle case where it's already closed
          try {
            controller.close();
          } catch (closeError: any) {
            // Controller might already be closed, which is fine
            if (closeError.code !== 'ERR_INVALID_STATE') {
              console.error('Error closing controller:', closeError);
            }
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('API error:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

