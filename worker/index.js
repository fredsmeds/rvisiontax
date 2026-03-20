/**
 * R Vision Tax - Cloudflare Worker API
 * Handles contact form submissions, onboarding with PDF generation, and email delivery
 */

// ==================== BRANDING CONFIGURATION ====================
// Update SITE_URL to match your deployed domain
const SITE_URL = 'https://rvisiontax.com';

const BRAND = {
  name: 'R Vision Tax LLC',
  tagline: 'Rigor. Re-Vision. Results.',
  color: {
    primary: '#3000ff',      // R Vision Blue
    black: '#000000',
    white: '#ffffff',
    darkGray: '#1a1a1a',
    lightGray: '#f5f5f5',
  },
  images: {
    logoBlack: `${SITE_URL}/images/logoblack.webp`,   // For light backgrounds
    logoWhite: `${SITE_URL}/images/logowhite.webp`,   // For dark backgrounds
    isotype: `${SITE_URL}/images/rblue.webp`,         // Blue "R" icon
  },
  contact: {
    address: '928 W Gunnison St, Chicago, IL 60640',
    phone: '+1 (312) 774-5397',
    email: 'info@rvisiontax.com',
  }
};
// ================================================================

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Route requests
      if (path === '/api/contact' && request.method === 'POST') {
        return await handleContact(request, env);
      }
      
      if (path === '/api/onboarding' && request.method === 'POST') {
        return await handleOnboarding(request, env);
      }

      if (path === '/api/health') {
        return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
      }

      // 404 for unknown routes
      return jsonResponse({ error: 'Not found' }, 404);

    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal server error', message: error.message }, 500);
    }
  },
};

/**
 * Handle simple contact form submissions
 */
async function handleContact(request, env) {
  const data = await request.json();
  
  // Validate required fields
  const required = ['name', 'phone', 'email', 'message'];
  for (const field of required) {
    if (!data[field]) {
      return jsonResponse({ error: `Missing required field: ${field}` }, 400);
    }
  }

  // Send email notification to Raul (admin)
  const adminEmailResult = await sendEmail(env, {
    to: env.RECIPIENT_EMAIL || 'raulmv@mastoinc.com',
    subject: `New Contact Form Submission - ${data.name}`,
    html: generateContactEmailHtml(data),
    text: generateContactEmailText(data),
  });

  // Send confirmation email to customer
  const clientEmailResult = await sendEmail(env, {
    to: data.email,
    subject: 'R Vision Tax - We Received Your Message / Recibimos Tu Mensaje',
    html: generateContactConfirmationHtml(data),
    text: generateContactConfirmationText(data),
  });

  if (!adminEmailResult.success) {
    return jsonResponse({ error: 'Failed to send email', details: adminEmailResult.error }, 500);
  }

  return jsonResponse({ 
    success: true, 
    message: 'Contact form submitted successfully',
    emailSent: {
      admin: adminEmailResult.success,
      client: clientEmailResult.success,
    }
  });
}

/**
 * Handle onboarding form submissions with PDF generation
 */
async function handleOnboarding(request, env) {
  const data = await request.json();
  
  // Validate essential fields
  if (!data.firstName || !data.lastName || !data.email) {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }

  // Generate PDF from form data
  let pdfBase64 = null;
  try {
    pdfBase64 = await generatePdf(env, data);
  } catch (pdfError) {
    console.error('PDF generation error:', pdfError);
    // Continue without PDF if generation fails
  }

  // Prepare email content
  const clientName = `${data.firstName} ${data.lastName}`;
  const submissionDate = new Date().toLocaleString('en-US', { 
    timeZone: 'America/Chicago',
    dateStyle: 'full',
    timeStyle: 'short'
  });

  // Send email to R Vision Tax
  const adminEmailResult = await sendEmail(env, {
    to: env.RECIPIENT_EMAIL || 'raulmv@mastoinc.com',
    subject: `New Tax Onboarding Submission - ${clientName}`,
    html: generateOnboardingEmailHtml(data, submissionDate, 'admin'),
    text: generateOnboardingEmailText(data, submissionDate),
    attachments: pdfBase64 ? [{
      filename: `RVisionTax_Intake_${data.lastName}_${Date.now()}.pdf`,
      content: pdfBase64,
      type: 'application/pdf',
    }] : [],
  });

  // Send confirmation email to client
  const clientEmailResult = await sendEmail(env, {
    to: data.email,
    subject: 'R Vision Tax - Onboarding Confirmation / Confirmación de Registro',
    html: generateOnboardingEmailHtml(data, submissionDate, 'client'),
    text: generateClientConfirmationText(data, submissionDate),
    attachments: pdfBase64 ? [{
      filename: `RVisionTax_Intake_${data.lastName}_${Date.now()}.pdf`,
      content: pdfBase64,
      type: 'application/pdf',
    }] : [],
  });

  // Store submission in KV if available (optional)
  if (env.SUBMISSIONS_KV) {
    const submissionId = `submission_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await env.SUBMISSIONS_KV.put(submissionId, JSON.stringify({
      ...data,
      submittedAt: new Date().toISOString(),
      signatures: data.signatures ? '[REDACTED]' : null, // Don't store full signature data
    }), { expirationTtl: 60 * 60 * 24 * 365 }); // 1 year retention
  }

  return jsonResponse({ 
    success: true, 
    message: 'Onboarding form submitted successfully',
    emailSent: {
      admin: adminEmailResult.success,
      client: clientEmailResult.success,
    },
    pdfGenerated: !!pdfBase64,
  });
}

/**
 * Generate PDF using Cloudflare Browser Rendering
 */
async function generatePdf(env, data) {
  const html = generatePdfHtml(data);
  
  // Use Browser Rendering API
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/pdf`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      html: html,
      pdfOptions: {
        printBackground: true,
        format: 'letter',
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in',
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Browser Rendering API error: ${response.status} - ${errorText}`);
  }

  const pdfBuffer = await response.arrayBuffer();
  
  // Convert to base64 safely (handles large files)
  const uint8Array = new Uint8Array(pdfBuffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * Send email using Resend API
 */
async function sendEmail(env, { to, subject, html, text, attachments = [] }) {
  const apiKey = env.RESEND_API_KEY;
  
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const emailData = {
    from: env.FROM_EMAIL || 'R Vision Tax <noreply@rvisiontax.com>',
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
  };

  // Add attachments if present
  if (attachments.length > 0) {
    emailData.attachments = attachments.map(att => ({
      filename: att.filename,
      content: att.content,
      type: att.type || 'application/octet-stream',
    }));
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Resend API error:', result);
      return { success: false, error: result };
    }

    return { success: true, id: result.id };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate HTML for PDF document
 */
function generatePdfHtml(data) {
  const lang = data.language || 'en';
  const isSpanish = lang === 'es';
  
  // Format date
  const today = new Date().toLocaleDateString(isSpanish ? 'es-US' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Build dependents table rows
  let dependentsRows = '';
  if (data.dependents && data.dependents.length > 0) {
    data.dependents.forEach(dep => {
      dependentsRows += `
        <tr>
          <td>${dep.name || ''}</td>
          <td>${dep.ssn || ''}</td>
          <td>${dep.dob || ''}</td>
          <td>${dep.relationship || ''}</td>
          <td>${dep.timeInUS || ''}</td>
        </tr>
      `;
    });
  } else {
    dependentsRows = `<tr><td colspan="5" style="text-align: center; color: #666;">${isSpanish ? 'No hay dependientes registrados' : 'No dependents listed'}</td></tr>`;
  }

  // Build expenses table rows
  let expensesRows = '';
  const expenseCategories = [
    { key: 'vehicleMiles', en: 'Vehicle & Truck Expenses / Mileage', es: 'Gastos de Vehículo y Camión / Millas' },
    { key: 'officeExpenses', en: 'Office Expenses', es: 'Gastos de Oficina' },
    { key: 'repairsMaintenance', en: 'Repairs & Maintenance', es: 'Reparaciones y Mantenimiento' },
    { key: 'supplies', en: 'Supplies', es: 'Suministros' },
    { key: 'taxesLicenses', en: 'Taxes & Licenses', es: 'Impuestos y Licencias' },
    { key: 'travelMealsEntertainment', en: 'Travel, Meals, Entertainment', es: 'Viajes, Comidas, Entretenimiento' },
    { key: 'otherExpenses1', en: 'Other Expenses', es: 'Otros Gastos' },
    { key: 'mealsEntertainment', en: 'Meals & Entertainment', es: 'Comidas y Entretenimiento' },
    { key: 'cellPhone', en: 'Cell Phone', es: 'Teléfono Celular' },
    { key: 'uniforms', en: 'Uniforms', es: 'Uniformes' },
    { key: 'shoes', en: 'Shoes', es: 'Zapatos' },
    { key: 'insurance', en: 'Insurance', es: 'Seguros' },
    { key: 'tolls', en: 'Tolls', es: 'Peajes' },
    { key: 'otherExpenses2', en: 'Other Expenses', es: 'Otros Gastos' },
  ];

  if (data.expenses) {
    expenseCategories.forEach(cat => {
      const value = data.expenses[cat.key] || '';
      if (value) {
        expensesRows += `
          <tr>
            <td>${isSpanish ? cat.es : cat.en}</td>
            <td style="text-align: right;">$${value}</td>
          </tr>
        `;
      }
    });
  }

  return `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      margin: 0.4in;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 11px;
      line-height: 1.4;
      color: #000;
      background: #fff;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 15px 20px;
      background: linear-gradient(135deg, #000 0%, #1a1a1a 100%);
      margin-bottom: 20px;
      border-bottom: 4px solid ${BRAND.color.primary};
    }
    .header-logo {
      height: 40px;
    }
    .header-info {
      text-align: right;
      color: #fff;
    }
    .header-info h1 {
      font-size: 14px;
      color: ${BRAND.color.primary};
      margin-bottom: 3px;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .header-info p {
      font-size: 10px;
      color: #ccc;
    }
    .document-title {
      text-align: center;
      padding: 15px;
      background: ${BRAND.color.primary};
      color: #fff;
      margin-bottom: 20px;
    }
    .document-title h2 {
      font-size: 16px;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .document-title p {
      font-size: 11px;
      margin-top: 5px;
      opacity: 0.9;
    }
    .section {
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    .section-title {
      background: ${BRAND.color.primary};
      color: #fff;
      padding: 8px 12px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-title::before {
      content: '';
      width: 6px;
      height: 6px;
      background: #fff;
      border-radius: 50%;
    }
    .field-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      padding: 0 10px;
    }
    .field {
      padding: 5px 0;
      border-bottom: 1px solid #eee;
    }
    .field-label {
      font-size: 9px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .field-value {
      font-size: 11px;
      font-weight: bold;
      color: #000;
      margin-top: 2px;
    }
    .full-width {
      grid-column: span 2;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 6px 8px;
      text-align: left;
      font-size: 10px;
    }
    th {
      background: #f5f5f5;
      font-weight: bold;
      text-transform: uppercase;
      font-size: 9px;
      letter-spacing: 0.5px;
    }
    .signature-section {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #3000ff;
    }
    .signature-box {
      display: inline-block;
      width: 45%;
      vertical-align: top;
      margin-right: 4%;
    }
    .signature-box:last-child {
      margin-right: 0;
    }
    .signature-img {
      max-width: 200px;
      max-height: 60px;
      border-bottom: 1px solid #000;
    }
    .signature-label {
      font-size: 9px;
      color: #666;
      margin-top: 5px;
    }
    .footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #ddd;
      text-align: center;
      font-size: 9px;
      color: #666;
    }
    .declaration {
      background: #f9f9f9;
      padding: 15px;
      margin: 20px 0;
      border-left: 4px solid #3000ff;
      font-size: 10px;
      line-height: 1.5;
    }
    .checkbox-item {
      padding: 3px 0;
    }
    .checkbox-item::before {
      content: '☑ ';
    }
  </style>
</head>
<body>
  <div class="header">
    <img src="${BRAND.images.logoWhite}" alt="R Vision Tax" class="header-logo" onerror="this.style.display='none'">
    <div class="header-info">
      <h1>${isSpanish ? 'Cuestionario Fiscal' : 'Tax Questionnaire'}</h1>
      <p>${BRAND.contact.phone} | ${BRAND.contact.email}</p>
    </div>
  </div>
  
  <div class="document-title">
    <h2>${isSpanish ? 'Formulario de Información del Cliente' : 'Client Information Form'}</h2>
    <p>${isSpanish ? 'Fecha de Envío' : 'Submission Date'}: ${today} | Ref: ${(data.lastName || 'CLIENT').toUpperCase()}-${Date.now().toString(36).toUpperCase()}</p>
  </div>

  <!-- Personal Information -->
  <div class="section">
    <div class="section-title">${isSpanish ? 'Información Personal' : 'Personal Information'}</div>
    <div class="field-grid">
      <div class="field">
        <div class="field-label">${isSpanish ? 'Nombres' : 'First Name'}</div>
        <div class="field-value">${data.firstName || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Apellidos' : 'Last Name'}</div>
        <div class="field-value">${data.lastName || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">SSN</div>
        <div class="field-value">${maskSSN(data.ssn)}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Fecha de Nacimiento' : 'Date of Birth'}</div>
        <div class="field-value">${data.dob || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Teléfono' : 'Phone'}</div>
        <div class="field-value">${data.phone || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Correo Electrónico' : 'Email'}</div>
        <div class="field-value">${data.email || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Ocupación' : 'Occupation'}</div>
        <div class="field-value">${data.occupation || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Tipo de ID' : 'ID Type'}</div>
        <div class="field-value">${data.idType || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Número de ID' : 'ID Number'}</div>
        <div class="field-value">${data.idNumber || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Fecha de Emisión' : 'Issue Date'}</div>
        <div class="field-value">${data.idIssueDate || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Fecha de Expiración' : 'Expiration Date'}</div>
        <div class="field-value">${data.idExpDate || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Estado Civil' : 'Marital Status'}</div>
        <div class="field-value">${data.maritalStatus || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Estudiante' : 'Student'}</div>
        <div class="field-value">${data.studentStatus || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Banco' : 'Bank'}</div>
        <div class="field-value">${data.bank || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Número de Ruta' : 'Routing Number'}</div>
        <div class="field-value">${data.routingNumber || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Número de Cuenta' : 'Account Number'}</div>
        <div class="field-value">${maskAccount(data.accountNumber)}</div>
      </div>
      <div class="field full-width">
        <div class="field-label">${isSpanish ? 'Dirección' : 'Address'}</div>
        <div class="field-value">${data.address || ''}, ${data.apt ? 'Apt ' + data.apt + ', ' : ''}${data.city || ''}, ${data.state || ''} ${data.zip || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">Identity Protection PIN</div>
        <div class="field-value">${data.ipPin || 'N/A'}</div>
      </div>
    </div>
  </div>

  <!-- Spouse Information (if married) -->
  ${data.maritalStatus && data.maritalStatus.toLowerCase().includes('married') ? `
  <div class="section">
    <div class="section-title">${isSpanish ? 'Información del Cónyuge' : 'Spouse Information'}</div>
    <div class="field-grid">
      <div class="field">
        <div class="field-label">${isSpanish ? 'Nombre' : 'First Name'}</div>
        <div class="field-value">${data.spouseFirstName || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Inicial' : 'M.I.'}</div>
        <div class="field-value">${data.spouseMI || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Apellido' : 'Last Name'}</div>
        <div class="field-value">${data.spouseLastName || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">SSN</div>
        <div class="field-value">${maskSSN(data.spouseSSN)}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Fecha de Nacimiento' : 'Date of Birth'}</div>
        <div class="field-value">${data.spouseDOB || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Teléfono' : 'Phone'}</div>
        <div class="field-value">${data.spousePhone || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Correo' : 'Email'}</div>
        <div class="field-value">${data.spouseEmail || ''}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? 'Ocupación' : 'Occupation'}</div>
        <div class="field-value">${data.spouseOccupation || ''}</div>
      </div>
    </div>
  </div>
  ` : ''}

  <!-- Dependents -->
  <div class="section">
    <div class="section-title">${isSpanish ? 'Dependientes' : 'Dependents'}</div>
    <table>
      <thead>
        <tr>
          <th>${isSpanish ? 'Nombre y Apellido' : 'Full Name'}</th>
          <th>SSN</th>
          <th>${isSpanish ? 'Fecha de Nacimiento' : 'Date of Birth'}</th>
          <th>${isSpanish ? 'Relación' : 'Relationship'}</th>
          <th>${isSpanish ? 'Tiempo en EE.UU.' : 'Time in US'}</th>
        </tr>
      </thead>
      <tbody>
        ${dependentsRows}
      </tbody>
    </table>
  </div>

  <!-- Income Information -->
  <div class="section">
    <div class="section-title">${isSpanish ? 'Información de Ingresos' : 'Income Information'}</div>
    <div class="field-grid">
      <div class="field">
        <div class="field-label">${isSpanish ? '¿Activos Digitales?' : 'Digital Assets?'}</div>
        <div class="field-value">${data.digitalAssets || 'No'}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? '¿Ingreso por Desempleo?' : 'Unemployment Income?'}</div>
        <div class="field-value">${data.unemploymentIncome || 'No'}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? '¿Beneficios SSN?' : 'SSN Benefits?'}</div>
        <div class="field-value">${data.ssnBenefits || 'No'}</div>
      </div>
      <div class="field">
        <div class="field-label">${isSpanish ? '¿Beneficios SSN Cónyuge?' : 'Spouse SSN Benefits?'}</div>
        <div class="field-value">${data.spouseSsnBenefits || 'No'}</div>
      </div>
    </div>
    <div style="padding: 10px;">
      <p style="font-weight: bold; margin-bottom: 5px;">${isSpanish ? 'Pagos de Impuestos Estimados:' : 'Estimated Tax Payments:'}</p>
      <div class="field-grid">
        <div class="field"><span class="field-label">Q1:</span> <span class="field-value">$${data.estimatedQ1 || '0'}</span></div>
        <div class="field"><span class="field-label">Q2:</span> <span class="field-value">$${data.estimatedQ2 || '0'}</span></div>
        <div class="field"><span class="field-label">Q3:</span> <span class="field-value">$${data.estimatedQ3 || '0'}</span></div>
        <div class="field"><span class="field-label">Q4:</span> <span class="field-value">$${data.estimatedQ4 || '0'}</span></div>
      </div>
    </div>
  </div>

  <!-- Self-Employed Expenses -->
  ${expensesRows ? `
  <div class="section">
    <div class="section-title">${isSpanish ? 'Gastos de Trabajador Independiente' : 'Self-Employed Expenses'}</div>
    <div class="field-grid" style="margin-bottom: 10px;">
      <div class="field full-width">
        <div class="field-label">${isSpanish ? 'Vehículo (Modelo, Marca & Año)' : 'Vehicle (Model, Make & Year)'}</div>
        <div class="field-value">${data.vehicleInfo || ''}</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>${isSpanish ? 'Categoría de Gasto' : 'Expense Category'}</th>
          <th style="width: 120px;">${isSpanish ? 'Monto (USD)' : 'Amount (USD)'}</th>
        </tr>
      </thead>
      <tbody>
        ${expensesRows}
      </tbody>
    </table>
  </div>
  ` : ''}

  <!-- Declaration -->
  <div class="declaration">
    <p><strong>${isSpanish ? 'DECLARACIÓN:' : 'DECLARATION:'}</strong></p>
    <p>${isSpanish 
      ? 'Bajo pena de perjurio, declaro que he examinado esta información y tengo toda la documentación y declaraciones de respaldo requeridas y, a mi leal saber y entender, son verdaderas, correctas y completas. También doy fe de que mi profesional de impuestos me informó de todas las consecuencias y sanciones relacionadas con mis impuestos y todas las deducciones que he realizado.'
      : 'Under penalty of perjury, I declare that I have examined this information and have all the required supporting documentation and statements and, to the best of my knowledge and belief, they are true, correct, and complete. I also attest to the fact that my tax professional informed me of all consequences and penalties related to my taxes and all deductions I have taken.'
    }</p>
  </div>

  <!-- Signatures -->
  <div class="signature-section">
    <div class="signature-box">
      ${data.signatures?.taxpayer ? `<img src="${data.signatures.taxpayer}" class="signature-img" alt="Taxpayer Signature">` : '<div style="height: 60px; border-bottom: 1px solid #000;"></div>'}
      <div class="signature-label">${isSpanish ? 'FIRMA DEL CONTRIBUYENTE' : 'TAXPAYER SIGNATURE'}</div>
      <div class="signature-label">${isSpanish ? 'Fecha' : 'Date'}: ${data.signatureDate || today}</div>
    </div>
    ${data.maritalStatus && data.maritalStatus.toLowerCase().includes('married') ? `
    <div class="signature-box">
      ${data.signatures?.spouse ? `<img src="${data.signatures.spouse}" class="signature-img" alt="Spouse Signature">` : '<div style="height: 60px; border-bottom: 1px solid #000;"></div>'}
      <div class="signature-label">${isSpanish ? 'FIRMA DEL CÓNYUGE' : 'SPOUSE SIGNATURE'}</div>
      <div class="signature-label">${isSpanish ? 'Fecha' : 'Date'}: ${data.signatureDate || today}</div>
    </div>
    ` : ''}
  </div>

  <div class="footer">
    <div style="display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 10px;">
      <img src="${BRAND.images.isotype}" alt="R" style="height: 25px;" onerror="this.style.display='none'">
      <strong style="font-size: 14px; color: ${BRAND.color.primary};">${BRAND.name}</strong>
    </div>
    <p>${BRAND.contact.address}</p>
    <p>${BRAND.contact.phone} | ${BRAND.contact.email}</p>
    <p style="margin-top: 10px; color: #999;">© ${new Date().getFullYear()} ${BRAND.name}. ${isSpanish ? 'Todos los derechos reservados.' : 'All rights reserved.'}</p>
  </div>
</body>
</html>
  `;
}

/**
 * Generate contact form email HTML
 */
function generateContactEmailHtml(data) {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: ${BRAND.color.black}; padding: 25px; text-align: center; }
    .header img { height: 35px; margin-bottom: 10px; }
    .header h1 { margin: 0; color: ${BRAND.color.primary}; font-size: 18px; letter-spacing: 1px; }
    .content { padding: 30px; background: #f9f9f9; }
    .field { margin-bottom: 15px; }
    .label { font-weight: bold; color: ${BRAND.color.primary}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .value { margin-top: 5px; padding: 12px; background: white; border-left: 4px solid ${BRAND.color.primary}; }
    .footer { background: ${BRAND.color.darkGray}; padding: 20px; text-align: center; font-size: 12px; color: #999; }
    .footer a { color: ${BRAND.color.primary}; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${BRAND.images.logoWhite}" alt="R Vision Tax" onerror="this.outerHTML='<div style=\\'color:${BRAND.color.primary};font-size:24px;font-weight:bold;\\'>R VISION TAX</div>'">
      <h1>New Contact Form Submission</h1>
    </div>
    <div class="content">
      <div class="field">
        <div class="label">Name:</div>
        <div class="value">${escapeHtml(data.name)}</div>
      </div>
      <div class="field">
        <div class="label">Phone:</div>
        <div class="value">${escapeHtml(data.phone)}</div>
      </div>
      <div class="field">
        <div class="label">Email:</div>
        <div class="value"><a href="mailto:${escapeHtml(data.email)}" style="color: ${BRAND.color.primary};">${escapeHtml(data.email)}</a></div>
      </div>
      <div class="field">
        <div class="label">Message:</div>
        <div class="value">${escapeHtml(data.message)}</div>
      </div>
    </div>
    <div class="footer">
      <p>Received: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}</p>
      <p>${BRAND.name} | ${BRAND.contact.address}</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate contact form email plain text
 */
function generateContactEmailText(data) {
  return `
NEW CONTACT FORM SUBMISSION
============================

Name: ${data.name}
Phone: ${data.phone}
Email: ${data.email}

Message:
${data.message}

---
Received: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}
R Vision Tax LLC | Chicago, IL
  `;
}

/**
 * Generate contact form confirmation HTML for customer
 */
function generateContactConfirmationHtml(data) {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: ${BRAND.color.black}; padding: 30px; text-align: center; }
    .header img { height: 40px; margin-bottom: 8px; }
    .header p { color: #888; font-size: 12px; margin: 0; letter-spacing: 1px; }
    .content { padding: 30px; background: #fff; }
    .highlight { background: #f0f0ff; padding: 20px; border-left: 4px solid ${BRAND.color.primary}; margin: 20px 0; }
    .footer { background: ${BRAND.color.darkGray}; color: #fff; padding: 20px; text-align: center; font-size: 12px; }
    .footer a { color: ${BRAND.color.primary}; text-decoration: none; }
    .btn { display: inline-block; background: ${BRAND.color.primary}; color: #fff; padding: 12px 25px; text-decoration: none; margin-top: 15px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${BRAND.images.logoWhite}" alt="R Vision Tax" onerror="this.outerHTML='<div style=\\'color:${BRAND.color.primary};font-size:28px;font-weight:bold;letter-spacing:2px;\\'>R VISION TAX</div>'">
      <p>${BRAND.tagline}</p>
    </div>
    <div class="content">
      <h2 style="color: ${BRAND.color.primary};">Thank you for contacting us!</h2>
      <h3 style="color: #666; font-weight: normal;">¡Gracias por contactarnos!</h3>
      
      <p>Dear ${escapeHtml(data.name)},</p>
      
      <p>We have received your message and will get back to you as soon as possible, typically within 1-2 business days.</p>
      
      <p style="color: #666;"><em>Hemos recibido tu mensaje y te responderemos lo antes posible, normalmente dentro de 1-2 días hábiles.</em></p>
      
      <div class="highlight">
        <strong>Your message:</strong><br>
        ${escapeHtml(data.message)}
      </div>
      
      <h3>Need immediate assistance? / ¿Necesitas ayuda inmediata?</h3>
      <p>
        <strong>Phone:</strong> ${BRAND.contact.phone}<br>
        <strong>Email:</strong> ${BRAND.contact.email}
      </p>
      
      <p>In the meantime, you can start your tax preparation by completing our online intake form:</p>
      <a href="${SITE_URL}/onboarding.html" class="btn">Start Onboarding →</a>
      
      <p style="margin-top: 30px;">Best regards,<br><strong>R Vision Tax Team</strong></p>
    </div>
    <div class="footer">
      <img src="${BRAND.images.isotype}" alt="R" style="height: 20px; margin-bottom: 10px;" onerror="this.style.display='none'">
      <p>${BRAND.name} | ${BRAND.contact.address}</p>
      <p>© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</p>
      <p style="margin-top: 10px;"><a href="${SITE_URL}/privacy.html">Privacy Policy</a> | <a href="${SITE_URL}/terms.html">Terms</a></p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate contact form confirmation plain text for customer
 */
function generateContactConfirmationText(data) {
  return `
R VISION TAX LLC
================

Thank you for contacting us! / ¡Gracias por contactarnos!

Dear ${data.name},

We have received your message and will get back to you as soon as possible, typically within 1-2 business days.

Hemos recibido tu mensaje y te responderemos lo antes posible, normalmente dentro de 1-2 días hábiles.

---
Your message:
${data.message}
---

Need immediate assistance?
Phone: +1 (312) 774-5397
Email: info@rvisiontax.com

You can also start your tax preparation by completing our online intake form at:
https://rvisiontax.com/onboarding.html

Best regards,
R Vision Tax Team

---
R Vision Tax LLC
928 W Gunnison St, Chicago, IL 60640
  `;
}

/**
 * Generate onboarding email HTML
 */
function generateOnboardingEmailHtml(data, submissionDate, recipient) {
  const isAdmin = recipient === 'admin';
  const clientName = `${data.firstName} ${data.lastName}`;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: ${BRAND.color.black}; padding: 30px; text-align: center; }
    .header img { height: 40px; margin-bottom: 10px; }
    .header h2 { color: ${BRAND.color.primary}; margin: 0; font-size: 16px; letter-spacing: 1px; }
    .header p { color: #888; margin: 5px 0 0; font-size: 12px; }
    .content { padding: 30px; background: #fff; }
    .highlight { background: #f0f0ff; padding: 20px; border-left: 4px solid ${BRAND.color.primary}; margin: 20px 0; }
    .info-grid { display: table; width: 100%; }
    .info-row { display: table-row; }
    .info-label { display: table-cell; padding: 8px; font-weight: bold; width: 40%; color: ${BRAND.color.primary}; font-size: 12px; }
    .info-value { display: table-cell; padding: 8px; }
    .footer { background: ${BRAND.color.darkGray}; color: #fff; padding: 20px; text-align: center; font-size: 12px; }
    .footer a { color: ${BRAND.color.primary}; text-decoration: none; }
    .btn { display: inline-block; background: ${BRAND.color.primary}; color: #fff; padding: 12px 30px; text-decoration: none; margin-top: 15px; font-weight: bold; }
    .steps { background: #f9f9f9; padding: 20px; margin: 20px 0; }
    .steps ol { margin: 0; padding-left: 20px; }
    .steps li { margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${BRAND.images.logoWhite}" alt="R Vision Tax" onerror="this.outerHTML='<div style=\\'color:${BRAND.color.primary};font-size:28px;font-weight:bold;letter-spacing:2px;\\'>R VISION TAX</div>'">
      <h2>${isAdmin ? 'New Onboarding Submission' : 'Thank You for Your Submission'}</h2>
      <p>${isAdmin ? 'New client intake received' : 'Gracias por tu envío'}</p>
    </div>
    <div class="content">
      ${isAdmin ? `
        <h2 style="color: ${BRAND.color.primary};">New Client Onboarding</h2>
        <div class="highlight">
          <strong>Client:</strong> ${escapeHtml(clientName)}<br>
          <strong>Email:</strong> <a href="mailto:${escapeHtml(data.email)}" style="color: ${BRAND.color.primary};">${escapeHtml(data.email)}</a><br>
          <strong>Phone:</strong> ${escapeHtml(data.phone)}<br>
          <strong>Submitted:</strong> ${submissionDate}
        </div>
        <p>A new onboarding form has been submitted. The completed intake form PDF is attached to this email.</p>
        <h3>Quick Summary</h3>
        <div class="info-grid">
          <div class="info-row">
            <div class="info-label">Marital Status:</div>
            <div class="info-value">${escapeHtml(data.maritalStatus || 'Not specified')}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Occupation:</div>
            <div class="info-value">${escapeHtml(data.occupation || 'Not specified')}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Dependents:</div>
            <div class="info-value">${data.dependents?.length || 0}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Digital Assets:</div>
            <div class="info-value">${data.digitalAssets || 'No'}</div>
          </div>
        </div>
      ` : `
        <h2 style="color: ${BRAND.color.primary};">Dear ${escapeHtml(data.firstName)},</h2>
        <p>Thank you for submitting your tax information to ${BRAND.name}. We have received your onboarding form and our team will review your documents shortly.</p>
        <p style="color: #666;"><em>Gracias por enviar tu información fiscal. Hemos recibido tu formulario y nuestro equipo revisará tus documentos pronto.</em></p>
        <div class="highlight">
          <strong>Submission Date:</strong> ${submissionDate}<br>
          <strong>Reference:</strong> ${data.lastName.toUpperCase()}-${Date.now().toString(36).toUpperCase()}
        </div>
        <h3 style="color: ${BRAND.color.primary};">What's Next? / ¿Qué sigue?</h3>
        <div class="steps">
          <ol>
            <li>Our tax specialists will review your submitted information</li>
            <li>We may contact you if we need any additional documentation</li>
            <li>Once complete, we'll prepare your tax return</li>
            <li>You'll receive your completed return for review and signature</li>
          </ol>
        </div>
        <p>A copy of your submitted intake form is attached to this email for your records.</p>
        <p>If you have any questions, please don't hesitate to contact us.</p>
        <p style="margin-top: 30px;">
          <strong>${BRAND.name}</strong><br>
          Phone: ${BRAND.contact.phone}<br>
          Email: ${BRAND.contact.email}
        </p>
      `}
    </div>
    <div class="footer">
      <img src="${BRAND.images.isotype}" alt="R" style="height: 20px; margin-bottom: 10px;" onerror="this.style.display='none'">
      <p>${BRAND.name} | ${BRAND.contact.address}</p>
      <p>© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</p>
      <p style="margin-top: 10px;"><a href="${SITE_URL}/privacy.html">Privacy Policy</a> | <a href="${SITE_URL}/terms.html">Terms & Conditions</a></p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate onboarding email plain text
 */
function generateOnboardingEmailText(data, submissionDate) {
  return `
NEW ONBOARDING SUBMISSION
==========================

Client: ${data.firstName} ${data.lastName}
Email: ${data.email}
Phone: ${data.phone}
Submitted: ${submissionDate}

Marital Status: ${data.maritalStatus || 'Not specified'}
Occupation: ${data.occupation || 'Not specified'}
Dependents: ${data.dependents?.length || 0}

The complete intake form PDF is attached.

---
R Vision Tax LLC
928 W Gunnison St, Chicago, IL 60640
+1 (312) 774-5397
  `;
}

/**
 * Generate client confirmation plain text
 */
function generateClientConfirmationText(data, submissionDate) {
  return `
R VISION TAX LLC
================

Dear ${data.firstName},

Thank you for submitting your tax information. We have received your onboarding form and will review it shortly.

Submission Date: ${submissionDate}
Reference: ${data.lastName.toUpperCase()}-${Date.now().toString(36).toUpperCase()}

WHAT'S NEXT:
1. Our tax specialists will review your information
2. We may contact you for additional documentation
3. We'll prepare your tax return
4. You'll receive your return for review and signature

A copy of your intake form is attached.

Questions? Contact us:
Phone: +1 (312) 774-5397
Email: info@rvisiontax.com

---
R Vision Tax LLC
928 W Gunnison St, Chicago, IL 60640
  `;
}

/**
 * Helper: JSON response with CORS headers
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

/**
 * Helper: Escape HTML special characters
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Helper: Mask SSN for display (show last 4 only)
 */
function maskSSN(ssn) {
  if (!ssn) return '';
  const cleaned = ssn.replace(/\D/g, '');
  if (cleaned.length >= 4) {
    return `XXX-XX-${cleaned.slice(-4)}`;
  }
  return 'XXX-XX-XXXX';
}

/**
 * Helper: Mask account number for display
 */
function maskAccount(account) {
  if (!account) return '';
  const cleaned = account.replace(/\D/g, '');
  if (cleaned.length >= 4) {
    return `****${cleaned.slice(-4)}`;
  }
  return '****';
}