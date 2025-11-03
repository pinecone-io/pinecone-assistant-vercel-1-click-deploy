'use client';

import React, { useMemo, useCallback } from 'react';
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import PersonIcon from '@mui/icons-material/Person';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import PineconeLogoIcon from '@/components/PineconeLogoIcon';
import type { AssistantChatMessage, AssistantChatMessageCitation } from '@/lib/types';

interface ChatMessageBlockProps {
  message: ChatBlockMessage;
}

interface ChatBlockMessage extends Omit<AssistantChatMessage, 'role'> {
  role: AssistantChatMessage['role'] | 'error';
}

const styles = {
  root: {
    display: 'flex',
    gap: 2,
    pb: 1,
  },
  link: {
    textDecoration: 'none',
    cursor: 'pointer',
    '&:hover': {
      textDecoration: 'underline',
    },
  },
  name: {
    fontWeight: 'bold',
    mb: 0.5,
  },
  content: {
    overflowWrap: 'anywhere',
    width: '100%',
    '> p': {
      mt: 0,
      mb: 2,
      mx: 0,
    },
    '> p:last-of-type': {
      mb: 0,
    },
    table: {
      my: 0.5,
      width: '100%',
      borderCollapse: 'collapse',
      borderSpacing: 0,
      th: {
        border: 1,
        borderColor: 'divider',
        fontWeight: '600',
        color: 'text.secondary',
        py: 0.5,
        px: 1,
      },
      td: {
        border: 1,
        borderColor: 'divider',
        py: 0.5,
        px: 1,
      },
    },
  },
  avatar: {
    border: 1,
    borderColor: 'divider',
    backgroundColor: 'background.paper',
  },
  inlineCitation: {
    display: 'inline',
    color: 'primary.main',
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
    ml: 0.25,
    fontSize: '0.9em',
    fontWeight: 500,
    '&:hover': {
      textDecorationStyle: 'solid',
    },
  },
  tooltipContent: {
    maxWidth: 300,
    p: 1,
  },
  tooltipFile: {
    fontWeight: 600,
    mb: 0.5,
  },
  tooltipMeta: {
    fontSize: '0.75rem',
    color: 'text.secondary',
    mt: 0.25,
  },
};

function getRoleContent(role: 'assistant' | 'user' | 'error') {
  switch (role) {
    case 'assistant':
      return {
        name: 'Pinecone',
        avatar: (
          <Avatar sx={styles.avatar}>
            <PineconeLogoIcon size={20} />
          </Avatar>
        ),
      };
    case 'user':
      return {
        name: 'You',
        avatar: (
          <Avatar sx={styles.avatar}>
            <PersonIcon sx={{ color: 'text.secondary' }} />
          </Avatar>
        ),
      };
    case 'error':
      return {
        name: 'Error',
        avatar: (
          <Avatar sx={styles.avatar}>
            <ErrorOutlineOutlinedIcon color="error" />
          </Avatar>
        ),
      };
    default:
      return {
        name: 'Pinecone',
        avatar: (
          <Avatar sx={styles.avatar}>
            <PineconeLogoIcon size={24} />
          </Avatar>
        ),
      };
  }
}

function InlineCitation({
  citationNumber,
  citation,
}: {
  citationNumber: number;
  citation: AssistantChatMessageCitation;
}) {
  const handleFileClick = async (fileId: string | null, signedUrl: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    if (fileId) {
      // Use server-side proxy to download file (handles fresh signed URLs and expiration)
      const link = document.createElement('a');
      link.href = `/api/files/${fileId}/download-file`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (signedUrl) {
      // Fallback: try direct URL if we don't have file ID
      window.open(signedUrl, '_blank');
    }
  };

  // Show all references without deduplication
  const references = citation.references;

  const tooltipContent = (
    <Box sx={styles.tooltipContent}>
      {references.map((ref, idx) => {
        const sortedPages = [...ref.pages].sort((a, b) => a - b);
        return (
          <Box key={`${ref.file.id}-${idx}`} sx={{ mb: 1 }}>
            <Typography sx={styles.tooltipFile}>
              {ref.file.name}
            </Typography>
            {(sortedPages.length > 0 || ref.highlight) && (
              <Box sx={styles.tooltipMeta}>
                {sortedPages.length > 0 && (
                  <div>Pages: {sortedPages.join(', ')}</div>
                )}
                {ref.highlight && (
                  <div>"{ref.highlight.content}"</div>
                )}
              </Box>
            )}
          </Box>
        );
      })}
      {references.some(ref => ref.file.signed_url) && (
        <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', mt: 0.5, fontStyle: 'italic' }}>
          Click citation to download files
        </Typography>
      )}
    </Box>
  );

  return (
    <Tooltip
      title={tooltipContent}
      placement="top"
      arrow
      enterDelay={200}
      leaveDelay={100}
    >
      <Box
        component="span"
        sx={styles.inlineCitation}
        onClick={(e) => {
          // Click on first available file
          const firstFile = references.find(ref => ref.file.signed_url || ref.file.id);
          if (firstFile) {
            handleFileClick(firstFile.file.id, firstFile.file.signed_url, e);
          }
        }}
      >
        [{citationNumber}]
      </Box>
    </Tooltip>
  );
}

function insertCitationMarkers(
  content: string,
  citations?: AssistantChatMessageCitation[]
): string {
  if (!citations || citations.length === 0) {
    return content;
  }

  // Filter out citations with invalid positions and sort by position
  const validCitations = citations
    .filter(citation => citation.position >= 0 && citation.position <= content.length)
    .sort((a, b) => a.position - b.position);
  
  if (validCitations.length === 0) {
    return content;
  }

  let result = content;

  // Insert markers from end to beginning to maintain correct string positions
  // Use sequential numbering based on sorted order
  for (let i = validCitations.length - 1; i >= 0; i--) {
    const citation = validCitations[i];
    // The marker index corresponds to the sorted order (0 = first citation)
    const marker = `[CITATION_${i}]`;
    result = result.slice(0, citation.position) + marker + result.slice(citation.position);
  }

  return result;
}

function ChatLink(props: React.ComponentProps<typeof Link>) {
  return <Link {...props} target="_blank" rel="noreferrer" sx={styles.link} />;
}

function ChatMessageBlock({
  message: { role, content, citations },
}: ChatMessageBlockProps) {
  const roleContent = getRoleContent(role);
  const assistantResponseIsLoading = role === 'assistant' && content === '';
  
  // Create a map of citation markers to citation data
  const citationMap = useMemo(() => {
    if (!citations || citations.length === 0) return new Map();
    const map = new Map<string, { number: number; citation: AssistantChatMessageCitation }>();
    // Filter valid citations and sort by position to match insertCitationMarkers
    const validCitations = citations
      .filter(citation => citation.position >= 0 && citation.position <= content.length)
      .sort((a, b) => a.position - b.position);
    validCitations.forEach((citation, idx) => {
      map.set(`CITATION_${idx}`, { number: idx + 1, citation });
    });
    return map;
  }, [citations, content]);

  const contentWithMarkers = role === 'assistant' && citations && citations.length > 0
    ? insertCitationMarkers(content, citations)
    : content;

  // Helper function to process nodes and replace citation markers
  const processNodeForCitations = useCallback((node: any): React.ReactNode => {
    if (typeof node === 'string') {
      const parts: React.ReactNode[] = [];
      const regex = /\[CITATION_(\d+)\]/g;
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(node)) !== null) {
        // Add text before marker
        if (match.index > lastIndex) {
          parts.push(node.slice(lastIndex, match.index));
        }
        
        // Add citation component
        const marker = match[1];
        const citationData = citationMap.get(`CITATION_${marker}`);
        if (citationData) {
          parts.push(
            <InlineCitation
              key={`citation-${marker}-${lastIndex}`}
              citationNumber={citationData.number}
              citation={citationData.citation}
            />
          );
        } else {
          // If citation not found in map, leave marker as-is (shouldn't happen, but safe fallback)
          parts.push(match[0]);
        }
        
        lastIndex = regex.lastIndex;
      }
      
      // Add remaining text
      if (lastIndex < node.length) {
        parts.push(node.slice(lastIndex));
      }
      
      return parts.length > 1 ? <>{parts}</> : node;
    }
    
    // Recursively process React elements
    if (React.isValidElement(node)) {
      const props = node.props as any;
      const children = props?.children;
      if (children !== undefined && children !== null) {
        const processedChildren = React.Children.map(children, processNodeForCitations);
        return React.cloneElement(node as any, { ...props, children: processedChildren });
      }
    }
    
    // Handle arrays
    if (Array.isArray(node)) {
      return node.map((item, idx) => (
        <React.Fragment key={idx}>
          {processNodeForCitations(item)}
        </React.Fragment>
      ));
    }
    
    return node;
  }, [citationMap]);

  // Custom component to replace citation markers in text
  const customComponents = useMemo(() => ({
    a: ChatLink,
    p: ({ children }: any) => {
      return (
        <p>
          {React.Children.map(children, processNodeForCitations)}
        </p>
      );
    },
    h1: ({ children }: any) => {
      return (
        <h1>
          {React.Children.map(children, processNodeForCitations)}
        </h1>
      );
    },
    h2: ({ children }: any) => {
      return (
        <h2>
          {React.Children.map(children, processNodeForCitations)}
        </h2>
      );
    },
    h3: ({ children }: any) => {
      return (
        <h3>
          {React.Children.map(children, processNodeForCitations)}
        </h3>
      );
    },
    h4: ({ children }: any) => {
      return (
        <h4>
          {React.Children.map(children, processNodeForCitations)}
        </h4>
      );
    },
    h5: ({ children }: any) => {
      return (
        <h5>
          {React.Children.map(children, processNodeForCitations)}
        </h5>
      );
    },
    h6: ({ children }: any) => {
      return (
        <h6>
          {React.Children.map(children, processNodeForCitations)}
        </h6>
      );
    },
    blockquote: ({ children }: any) => {
      return (
        <blockquote>
          {React.Children.map(children, processNodeForCitations)}
        </blockquote>
      );
    },
    li: ({ children }: any) => {
      return (
        <li>
          {React.Children.map(children, processNodeForCitations)}
        </li>
      );
    },
    td: ({ children }: any) => {
      return (
        <td>
          {React.Children.map(children, processNodeForCitations)}
        </td>
      );
    },
    th: ({ children }: any) => {
      return (
        <th>
          {React.Children.map(children, processNodeForCitations)}
        </th>
      );
    },
    strong: ({ children }: any) => {
      return (
        <strong>
          {React.Children.map(children, processNodeForCitations)}
        </strong>
      );
    },
    em: ({ children }: any) => {
      return (
        <em>
          {React.Children.map(children, processNodeForCitations)}
        </em>
      );
    },
    code: ({ children, ...props }: any) => {
      // Don't process citations in inline code - leave as raw text
      return <code {...props}>{children}</code>;
    },
    pre: ({ children, ...props }: any) => {
      // Don't process citations in code blocks - leave as raw text
      return <pre {...props}>{children}</pre>;
    },
  }), [processNodeForCitations]);

  return (
    <div>
      <Box sx={styles.root}>
        {roleContent.avatar}
        <Box sx={{ width: '100%' }}>
          <Typography sx={styles.name} color={role === 'error' ? 'error' : undefined}>
            {roleContent.name}
          </Typography>
          <Typography
            sx={styles.content}
            data-testid="message-content"
            color={role === 'error' ? 'error' : undefined}
          >
            {assistantResponseIsLoading ? <CircularProgress size={14} sx={{ mt: 0.5 }} /> : null}
            <ReactMarkdown
              remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
              rehypePlugins={[rehypeKatex]}
              components={customComponents}
            >
              {contentWithMarkers}
            </ReactMarkdown>
          </Typography>
        </Box>
      </Box>
    </div>
  );
}

export default ChatMessageBlock;

