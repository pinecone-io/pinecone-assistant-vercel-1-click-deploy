import { NextRequest, NextResponse } from 'next/server';
import { getAssistant } from '@/lib/pinecone';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const assistantName = process.env.PINECONE_ASSISTANT_NAME;

    if (!assistantName) {
      return NextResponse.json(
        { error: 'PINECONE_ASSISTANT_NAME environment variable is not set' },
        { status: 500 }
      );
    }

    const { fileId } = await params;
    
    if (!fileId) {
      return NextResponse.json(
        { error: 'File ID is required' },
        { status: 400 }
      );
    }

    const assistant = getAssistant(assistantName);
    
    // Get fresh signed URL and file details
    const fileDetails = await assistant.describeFile(fileId, true);
    const details = fileDetails as any;
    const signedUrl = details.signedUrl || details.signed_url;
    const fileName = details.name || 'download';
    
    if (!signedUrl) {
      return NextResponse.json(
        { error: 'No signed URL available for this file' },
        { status: 404 }
      );
    }

    // Immediately fetch the file from the signed URL (server-side, no CORS issues)
    const fileResponse = await fetch(signedUrl);
    
    if (!fileResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to download file from storage' },
        { status: fileResponse.status }
      );
    }

    // Get the file content
    const fileBuffer = await fileResponse.arrayBuffer();
    
    // Get content type and set proper download headers
    const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';
    
    // Return the file with download headers
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error: any) {
    console.error('Error downloading file:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

