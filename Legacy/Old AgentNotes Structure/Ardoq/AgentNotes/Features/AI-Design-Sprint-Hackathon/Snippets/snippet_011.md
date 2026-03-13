# Snippet 011 - Added Markdown Rendering

## Changes

### Installed Package
```bash
npm install react-markdown
```

### Updated Files

**frontend/src/Chat.tsx**
- Imported `ReactMarkdown`
- Wrapped message content with `<ReactMarkdown>{msg.content}</ReactMarkdown>`

**frontend/src/Chat.css**
- Added styling for markdown elements:
  - Headers (h1-h6) with proper spacing
  - Paragraphs with margins
  - Lists (ul/ol) with indentation
  - Inline code with grey background
  - Code blocks with grey background and overflow
  - Blockquotes with left border
  - Links with blue color

## Features
- Full markdown support (headers, lists, code blocks, links, etc.)
- Inline code and code blocks styled with grey backgrounds
- Proper spacing between elements
- Responsive overflow for long code blocks
