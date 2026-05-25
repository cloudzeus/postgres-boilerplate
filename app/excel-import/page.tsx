'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ExcelImportPage() {
    const [message, setMessage] = useState('Σύρε το αρχείο εδώ ή κάνε κλικ για να ανεβάσεις.');

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (!file) return;
        setMessage(`Ανέβασμα ${file.name}...`);
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/import/excel', { method: 'POST', body: formData });
        if (response.ok) {
            setMessage('Το αρχείο ανέβηκε και επεξεργάστηκε επιτυχώς.');
        } else {
            setMessage('Υπήρξε σφάλμα κατά το ανέβασμα.');
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [] } });

    return (
        <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
            <div className="mx-auto max-w-4xl rounded-[2rem] border border-slate-800 bg-slate-900/90 p-8 shadow-panel">
                <div className="flex items-center gap-4">
                    <UploadCloud className="h-6 w-6 text-cyan-400" />
                    <div>
                        <p className="text-sm uppercase tracking-[0.28em] text-slate-400">Excel Import</p>
                        <h1 className="text-2xl font-semibold text-white">Ανεβάστε το αρχείο σας</h1>
                    </div>
                </div>
                <section className="mt-8 rounded-3xl border border-slate-800 bg-slate-950/80 p-8 text-center">
                    <div {...getRootProps()} className="cursor-pointer rounded-3xl border-2 border-dashed border-slate-700 bg-slate-900/70 p-12 transition hover:border-cyan-500">
                        <input {...getInputProps()} />
                        <p className="text-sm text-slate-400">{isDragActive ? 'Απελευθέρωσε το αρχείο εδώ...' : message}</p>
                        <Button className="mt-6" variant="secondary">Επιλέξτε αρχείο Excel</Button>
                    </div>
                </section>
            </div>
        </main>
    );
}
