# Repository guidance

## Language

- Use US English for all first-party public documentation, examples, code comments,
  user-facing messages, and metadata, including README files and MCP tool descriptions.
- Before finishing a text change, check all added or edited prose with the language
  MCP tool `check_us_english_text`. Use `validate_us_english_word` when an individual
  word needs clarification. Review every flag, fix genuine spelling errors and
  British usage, and rerun the check after corrections.
- Preserve proper names, product names, identifiers, commands, URLs, paths, and
  technical syntax. Do not rename code or change behavior to satisfy a spelling check.
- Preserve quoted data, third-party license text, and externally indexed documentation
  verbatim. Do not translate or normalize upstream documentation. Explain intentional
  exceptions and any unavailable language checks in the completion report.

## Verification

- Read applicable repository guidance before editing.
- Keep documentation changes separate from behavior changes.
- Run `npm test` and `npm run build` before finishing; report failures accurately.
