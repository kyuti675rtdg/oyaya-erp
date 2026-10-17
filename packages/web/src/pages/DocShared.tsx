import type { BadgeTone } from '../components/Badge';

export const cardShell =
  'bg-white rounded-2xl p-5 border border-slate-100 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]';

export const DOC_STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  UNDER_REVIEW: 'advisory',
  APPROVED: 'pass',
  PUBLISHED: 'pass',
  ARCHIVED: 'neutral',
  PENDING: 'advisory',
  REJECTED: 'critical',
};

export const DOC_CATEGORIES = [
  'General',
  'Policy',
  'SOP',
  'Report',
  'Contract',
  'Certificate',
  'Manual',
  'Form',
  'Drawing',
  'Other',
];

export const DOC_MODULES = [
  'Procurement',
  'Storage',
  'Production',
  'Quality',
  'CAPA',
  'Sanitation',
  'Pest Control',
  'Maintenance',
  'Finished Goods',
  'Warehouse',
  'Traceability',
  'Sales',
  'Finance',
  'HR',
  'Fleet',
  'BI',
  'Admin',
  'Support',
  'Documents',
];

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fileKindLabel(mime: string, fileName: string): string {
  const m = mime.toLowerCase();
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (m.includes('pdf') || ext === 'pdf') return 'PDF';
  if (m.includes('word') || ['doc', 'docx'].includes(ext)) return 'Word';
  if (m.includes('sheet') || m.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext)) return 'Excel';
  if (m.includes('presentation') || ['ppt', 'pptx'].includes(ext)) return 'Slides';
  if (m.startsWith('image/')) return 'Image';
  if (m.startsWith('text/') || ext === 'md' || ext === 'txt') return 'Text';
  if (m.includes('zip') || ['zip', 'rar', '7z'].includes(ext)) return 'Archive';
  return ext ? ext.toUpperCase() : 'File';
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
