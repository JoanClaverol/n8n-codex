/**
 * Strip markdown the model leaks despite the plain-text instruction.
 * Conservative on purpose: paired markers must hug non-whitespace, so
 * n8n expressions like "{{ $json.x * 2 }}", "2 ** 8", "a_b_c", or a lone
 * "del /q *" pass through untouched.
 */
export function plainText(text) {
  return text
    .replace(/^ {0,3}```.*\n?/gm, '') // fence lines; the code itself stays
    .replace(/\*\*\*(\S(?:[^*]*\S)?)\*\*\*/g, '$1')
    .replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, '$1')
    .replace(/(^|\W)\*(\S(?:[^*\n]*\S)?)\*(?=\W|$)/gm, '$1$2')
    .replace(/(^|\W)___(\S(?:[^_]*\S)?)___(?=\W|$)/gm, '$1$2')
    .replace(/(^|\W)__(\S(?:[^_]*\S)?)__(?=\W|$)/gm, '$1$2')
    .replace(/(^|\W)_(\S(?:[^_\n]*\S)?)_(?=\W|$)/gm, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^(\s*)[*+]\s+/gm, '$1- ') // */+ bullets → plain dashes
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
}
