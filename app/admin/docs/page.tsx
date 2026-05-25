import 'swagger-ui-react/swagger-ui.css';
import { FiFileText, FiDownload, FiSmartphone } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/page-header';
import SwaggerUIClient from '@/components/swagger-ui-client';

export const metadata = { title: 'API Documentation · DGEspa' };

export default function DocsPage() {
  return (
    <div className="w-full">
      <PageHeader
        icon={<FiFileText />}
        title="API Documentation"
        description="Πλήρης τεκμηρίωση του REST API. Καταναλώνεται από το mobile app της DGEspa."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <a href="/api/openapi" target="_blank" rel="noopener">
                <FiDownload /> OpenAPI JSON
              </a>
            </Button>
            <Button variant="outline" disabled>
              <FiSmartphone /> Mobile SDK (coming)
            </Button>
          </div>
        }
      />
      <div className="bg-card border border-border rounded-xl shadow-card p-2 lg:p-4 overflow-hidden">
        <SwaggerUIClient />
      </div>
    </div>
  );
}
