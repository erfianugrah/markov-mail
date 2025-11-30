interface ExportButtonProps {
  data: Record<string, unknown>[];
  filename: string;
  format?: 'csv' | 'json';
  className?: string;
}

export default function ExportButton({
  data,
  filename,
  format = 'csv',
  className = '',
}: ExportButtonProps) {
  const handleExport = () => {
    if (!data || data.length === 0) {
      alert('No data to export');
      return;
    }

    let content: string;
    let mimeType: string;
    let extension: string;

    if (format === 'csv') {
      // Convert to CSV
      const headers = Object.keys(data[0]);
      const csvRows = [
        headers.join(','),
        ...data.map((row) =>
          headers.map((header) => {
            const value = row[header];
            // Escape quotes and wrap in quotes if contains comma
            const stringValue = String(value ?? '');
            return stringValue.includes(',') || stringValue.includes('"')
              ? `"${stringValue.replace(/"/g, '""')}"`
              : stringValue;
          }).join(',')
        ),
      ];
      content = csvRows.join('\n');
      mimeType = 'text/csv';
      extension = 'csv';
    } else {
      // Convert to JSON
      content = JSON.stringify(data, null, 2);
      mimeType = 'application/json';
      extension = 'json';
    }

    // Create download link
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleExport}
      className={`px-3 py-1.5 text-sm border border-border rounded-md hover:bg-accent transition-colors ${className}`}
    >
      Export {format.toUpperCase()}
    </button>
  );
}
