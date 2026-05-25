'use client';

import SwaggerUI from 'swagger-ui-react';

export default function SwaggerUIClient() {
  return (
    <div className="swagger-wrapper">
      <SwaggerUI url="/api/openapi" docExpansion="list" defaultModelsExpandDepth={1} />
    </div>
  );
}
