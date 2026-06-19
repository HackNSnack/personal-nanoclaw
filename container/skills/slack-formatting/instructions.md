## Slack formatting (mrkdwn)

When replying in a Slack channel, use Slack mrkdwn — **not** standard Markdown.

### Quick reference

| Style           | Write this                                     |
| --------------- | ---------------------------------------------- |
| Bold            | `*text*` — single asterisk                     |
| Italic          | `_text_`                                       |
| Strikethrough   | `~text~`                                       |
| Inline code     | `` `code` ``                                   |
| Code block      | ` ```code``` `                                 |
| Named link      | `<https://example.com\|Link text>`             |
| Mention user    | `<@UXXXXXXX>` (user ID, not display name)      |
| Mention channel | `<#CXXXXXXX>`                                  |
| Emoji           | `:white_check_mark:` `:rocket:` `:tada:` `:x:` |
| Block quote     | `> text`                                       |
| Bullet          | `• item` or `- item`                           |

### Never use in Slack

- `##` headings — use `*Bold text*` as a section header instead
- `**double asterisks**` for bold — use `*single asterisks*`
- `[text](url)` links — use `<url|text>` instead
- Numbered lists — bullets only (e.g. `• 1. First item` if ordering matters)
- Tables — use a code block or spaced plain text
- `---` horizontal rules
