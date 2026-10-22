import { TranscriptSegment, VideoAnalysis } from './types';

/**
 * Format seconds to HH:MM:SS timestamp
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format seconds to SRT timestamp (HH:MM:SS,mmm)
 */
function formatSrtTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * Format seconds to VTT timestamp (HH:MM:SS.mmm)
 */
function formatVttTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function getSpeakerName(speaker: string, mapping: Record<string, string>): string {
  return mapping[speaker] || speaker;
}

/**
 * Export transcript as plain text
 */
export function exportToTxt(analysis: VideoAnalysis, title: string): string {
  let output = `${'='.repeat(60)}\n`;
  output += `  ${title} - Video Analysis Report\n`;
  output += `${'='.repeat(60)}\n\n`;

  if (analysis.executive_summary) {
    output += `EXECUTIVE SUMMARY\n${'-'.repeat(40)}\n${analysis.executive_summary}\n\n`;
  }

  if (analysis.detailed_synopsis) {
    output += `DETAILED SYNOPSIS\n${'-'.repeat(40)}\n${analysis.detailed_synopsis}\n\n`;
  }

  if (analysis.topics.length > 0) {
    output += `KEY TOPICS\n${'-'.repeat(40)}\n`;
    analysis.topics.forEach((topic, i) => {
      output += `  ${i + 1}. ${topic}\n`;
    });
    output += '\n';
  }

  if (analysis.important_points.length > 0) {
    output += `IMPORTANT POINTS\n${'-'.repeat(40)}\n`;
    analysis.important_points.forEach((point, i) => {
      output += `  ${i + 1}. ${point}\n`;
    });
    output += '\n';
  }

  if (analysis.key_moments.length > 0) {
    output += `KEY MOMENTS\n${'-'.repeat(40)}\n`;
    analysis.key_moments.forEach((moment) => {
      output += `  [${formatTimestamp(moment.timestamp)}] ${moment.title}\n`;
      output += `    ${moment.description}\n\n`;
    });
  }

  if (analysis.meeting_overview) {
    output += `MEETING OVERVIEW\n${'-'.repeat(40)}\n${analysis.meeting_overview}\n\n`;
  }

  if (analysis.meeting_decisions.length > 0) {
    output += `DECISIONS MADE\n${'-'.repeat(40)}\n`;
    analysis.meeting_decisions.forEach((d, i) => {
      output += `  ${i + 1}. ${d}\n`;
    });
    output += '\n';
  }

  if (analysis.action_items.length > 0) {
    output += `ACTION ITEMS\n${'-'.repeat(40)}\n`;
    analysis.action_items.forEach((item, i) => {
      output += `  ${i + 1}. [${item.priority.toUpperCase()}] ${item.task}\n`;
      output += `     Assignee: ${getSpeakerName(item.assignee, analysis.speaker_mapping)} | Deadline: ${item.deadline}\n\n`;
    });
  }

  if (analysis.unresolved_questions.length > 0) {
    output += `UNRESOLVED QUESTIONS\n${'-'.repeat(40)}\n`;
    analysis.unresolved_questions.forEach((q, i) => {
      output += `  ${i + 1}. ${q}\n`;
    });
    output += '\n';
  }

  if (analysis.transcript_segments.length > 0) {
    output += `\nFULL TRANSCRIPT\n${'='.repeat(60)}\n\n`;
    analysis.transcript_segments.forEach((seg) => {
      const speaker = getSpeakerName(seg.speaker, analysis.speaker_mapping);
      output += `[${formatTimestamp(seg.start)} - ${formatTimestamp(seg.end)}] ${speaker}:\n`;
      output += `  ${seg.text}\n\n`;
    });
  }

  return output;
}

/**
 * Export transcript as SRT subtitle format
 */
export function exportToSrt(segments: TranscriptSegment[], mapping: Record<string, string>): string {
  return segments
    .map((seg, i) => {
      const speaker = getSpeakerName(seg.speaker, mapping);
      return `${i + 1}\n${formatSrtTimestamp(seg.start)} --> ${formatSrtTimestamp(seg.end)}\n${speaker}: ${seg.text}\n`;
    })
    .join('\n');
}

/**
 * Export transcript as WebVTT subtitle format
 */
export function exportToVtt(segments: TranscriptSegment[], mapping: Record<string, string>): string {
  let output = 'WEBVTT\n\n';
  segments.forEach((seg, i) => {
    const speaker = getSpeakerName(seg.speaker, mapping);
    output += `${i + 1}\n${formatVttTimestamp(seg.start)} --> ${formatVttTimestamp(seg.end)}\n${speaker}: ${seg.text}\n\n`;
  });
  return output;
}

/**
 * Export analysis as Markdown
 */
export function exportToMarkdown(analysis: VideoAnalysis, title: string): string {
  let md = `# ${title} - Video Analysis Report\n\n`;
  md += `*Generated on ${new Date().toLocaleDateString()}*\n\n---\n\n`;

  if (analysis.executive_summary) {
    md += `## Executive Summary\n\n${analysis.executive_summary}\n\n`;
  }

  if (analysis.detailed_synopsis) {
    md += `## Detailed Synopsis\n\n${analysis.detailed_synopsis}\n\n`;
  }

  if (analysis.topics.length > 0) {
    md += `## Key Topics\n\n`;
    analysis.topics.forEach((topic) => {
      md += `- ${topic}\n`;
    });
    md += '\n';
  }

  if (analysis.important_points.length > 0) {
    md += `## Important Points\n\n`;
    analysis.important_points.forEach((point) => {
      md += `- ${point}\n`;
    });
    md += '\n';
  }

  if (analysis.key_moments.length > 0) {
    md += `## Key Moments\n\n`;
    md += `| Timestamp | Title | Description |\n`;
    md += `|-----------|-------|-------------|\n`;
    analysis.key_moments.forEach((moment) => {
      md += `| ${formatTimestamp(moment.timestamp)} | ${moment.title} | ${moment.description} |\n`;
    });
    md += '\n';
  }

  if (analysis.meeting_overview) {
    md += `## Meeting Overview\n\n${analysis.meeting_overview}\n\n`;
  }

  if (analysis.meeting_decisions.length > 0) {
    md += `## Decisions Made\n\n`;
    analysis.meeting_decisions.forEach((d, i) => {
      md += `${i + 1}. ${d}\n`;
    });
    md += '\n';
  }

  if (analysis.action_items.length > 0) {
    md += `## Action Items\n\n`;
    md += `| # | Task | Assignee | Deadline | Priority |\n`;
    md += `|---|------|----------|----------|----------|\n`;
    analysis.action_items.forEach((item, i) => {
      md += `| ${i + 1} | ${item.task} | ${getSpeakerName(item.assignee, analysis.speaker_mapping)} | ${item.deadline} | ${item.priority} |\n`;
    });
    md += '\n';
  }

  if (analysis.unresolved_questions.length > 0) {
    md += `## Unresolved Questions\n\n`;
    analysis.unresolved_questions.forEach((q) => {
      md += `- ${q}\n`;
    });
    md += '\n';
  }

  if (analysis.transcript_segments.length > 0) {
    md += `## Full Transcript\n\n`;
    analysis.transcript_segments.forEach((seg) => {
      const speaker = getSpeakerName(seg.speaker, analysis.speaker_mapping);
      md += `**[${formatTimestamp(seg.start)}] ${speaker}:** ${seg.text}\n\n`;
    });
  }

  return md;
}

/**
 * Trigger browser download of a file
 */
export function downloadFile(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
