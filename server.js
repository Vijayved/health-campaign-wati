const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ==================== MongoDB Connection ====================
console.log('🔌 Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err.message));

// ==================== Lead Schema ====================
const leadSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  name: { type: String, default: '' },
  branch: { type: String, default: 'Usmanpura' },
  testType: { type: String, default: '' },
  testDetails: { type: String, default: '' },
  executiveAssigned: { type: String, default: '' },
  executivePhone: { type: String, default: '' },
  status: {
    type: String,
    enum: ['new', 'assigned', 'converted', 'waiting', 'not_converted'],
    default: 'new'
  },
  source: { type: String, default: 'WATI_Campaign' },
  campaign: { type: String, default: 'health_checkup' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Lead = mongoose.model('Lead', leadSchema);

// ==================== Executive Configuration ====================
const executives = [
  { name: 'Aditi', phone: '8488931212', whatsapp: '8488931212', active: true, leadCount: 0 },
  { name: 'Khyati', phone: '7490029085', whatsapp: '7490029085', active: true, leadCount: 0 },
  { name: 'Jay', phone: '9274682553', whatsapp: '9274682553', active: true, leadCount: 0 },
  { name: 'Mital', phone: '9558591212', whatsapp: '9558591212', active: true, leadCount: 0 }
];

let currentExecutiveIndex = 0;

function getNextExecutive() {
  const activeExecs = executives.filter(e => e.active);
  if (activeExecs.length === 0) return null;
  const exec = activeExecs[currentExecutiveIndex % activeExecs.length];
  currentExecutiveIndex++;
  return exec;
}

// ==================== WATI API Configuration ====================
// IMPORTANT: WATI_BASE_URL should include the tenant number
// Example: https://live-mt-server.wati.io/1110
const WATI_BASE_URL = process.env.WATI_API_URL || 'https://live-mt-server.wati.io/1110';
const WATI_API_KEY = process.env.WATI_API_KEY;

// Send WhatsApp Template Message (CORRECT FORMAT)
async function sendWatiTemplate(phoneNumber, templateName, params = []) {
  try {
    // Clean phone number (remove +91, ensure 10 digits)
    let cleanPhone = phoneNumber.replace(/^\+91/, '').replace(/[^0-9]/g, '');
    
    // Full URL for template API
    const url = `${WATI_BASE_URL}/api/v1/sendTemplateMessages?phone=${cleanPhone}`;
    
    // Format parameters as object for WATI
    const parameters = {};
    params.forEach(p => {
      parameters[p.name] = p.value;
    });
    
    const payload = {
      template_name: templateName,
      broadcast_name: `Health_Campaign_${Date.now()}`,
      parameters: parameters
    };
    
    console.log(`\n📤 SENDING TEMPLATE:`);
    console.log(`   URL: ${url}`);
    console.log(`   Phone: ${cleanPhone}`);
    console.log(`   Template: ${templateName}`);
    console.log(`   Params:`, JSON.stringify(parameters, null, 2));
    console.log(`   Full Payload:`, JSON.stringify(payload, null, 2));
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ TEMPLATE SENT SUCCESSFULLY to ${cleanPhone}`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error(`❌ TEMPLATE FAILED for ${phoneNumber}:`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`   Error: ${error.message}`);
    }
    return null;
  }
}

// Send Text Message (Session Message)
async function sendWatiText(phoneNumber, text) {
  try {
    let cleanPhone = phoneNumber.replace(/^\+91/, '').replace(/[^0-9]/g, '');
    const url = `${WATI_BASE_URL}/api/v1/sendSessionMessage/${cleanPhone}`;
    const payload = { text };
    
    console.log(`📤 Sending text to ${cleanPhone}`);
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Text sent to ${cleanPhone}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Text failed for ${phoneNumber}:`, error.response?.data || error.message);
    return null;
  }
}

// ==================== Webhook ====================
app.post('/webhook/wati', async (req, res) => {
  console.log('\n📨 ========== WATI WEBHOOK ==========');
  console.log('Time:', new Date().toISOString());
  console.log('Data:', JSON.stringify(req.body, null, 2));
  
  try {
    const data = req.body;
    let phoneNumber = data.waId || data.phoneNumber || data.from;
    let message = data.text || data.message;
    
    // Handle button clicks
    if (data.buttonReply?.text) message = data.buttonReply.text;
    if (data.interactiveButtonReply?.title) message = data.interactiveButtonReply.title;
    
    console.log(`📞 Phone: ${phoneNumber}`);
    console.log(`💬 Message: ${message}`);
    
    if (!phoneNumber) return res.status(200).send('OK');
    
    phoneNumber = phoneNumber.replace(/^\+91/, '').replace(/[^0-9]/g, '');
    
    if (message && (message.toLowerCase() === 'book now' || message.toLowerCase().includes('book now'))) {
      await handleCampaignLead(phoneNumber);
    } else if (message && message.trim()) {
      await handlePatientReply(phoneNumber, message);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('OK');
  }
});

// Handle New Campaign Lead
async function handleCampaignLead(phoneNumber) {
  console.log('\n🎯 NEW LEAD:', phoneNumber);
  
  const existing = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  if (existing) {
    console.log(`⚠️ Lead exists: ${existing.status}`);
    return;
  }
  
  const executive = getNextExecutive();
  if (!executive) return console.log('❌ No executive');
  
  console.log(`👤 Assigned: ${executive.name} (${executive.whatsapp})`);
  
  const lead = new Lead({
    phoneNumber,
    executiveAssigned: executive.name,
    executivePhone: executive.whatsapp,
    status: 'assigned'
  });
  await lead.save();
  console.log(`✅ Lead saved: ${lead._id}`);
  
  // Template names from env
  const leadTemplate = process.env.LEAD_TEMPLATE_NAME || 'campaign_women';
  const execTemplate = process.env.EXECUTIVE_TEMPLATE_NAME || 'new_lead_campaign';
  
  // Links
  const mLink = process.env.MAMMOGRAPHY_LINK || 'https://www.nibib.nih.gov/sites/default/files/2022-05/Fact-Sheet-Mammography.pdf';
  const dLink = process.env.DEXA_LINK || 'https://www.youtube.com/watch?v=HkLuviUi8Mc';
  const bLink = process.env.BLOOD_PACKAGE_LINK || 'https://www.airmedlabs.com/';
  const bookLink = process.env.BOOKING_LINK || `https://wa.me/${phoneNumber}?text=I%20want%20to%20book`;
  
  // Send to customer
  console.log(`📤 Sending to customer (${leadTemplate}):`);
  await sendWatiTemplate(phoneNumber, leadTemplate, [
    { name: '1', value: mLink },
    { name: '2', value: dLink },
    { name: '3', value: bLink },
    { name: '4', value: bookLink }
  ]);
  
  // Send to executive
  console.log(`📤 Sending to executive (${execTemplate}):`);
  const callLink = `tel:+91${executive.phone}`;
  const chatLink = `https://wa.me/${executive.whatsapp}?text=Hi%20${encodeURIComponent(executive.name)}%2C%20New%20lead%20${phoneNumber}`;
  const timeNow = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  
  await sendWatiTemplate(executive.whatsapp, execTemplate, [
    { name: '1', value: phoneNumber },
    { name: '2', value: callLink },
    { name: '3', value: chatLink },
    { name: '4', value: timeNow }
  ]);
  
  console.log(`✅ Lead processed for ${phoneNumber}`);
  executive.leadCount++;
}

// Handle Patient Replies
async function handlePatientReply(phoneNumber, message) {
  const lead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  if (!lead) {
    console.log(`⚠️ No lead for ${phoneNumber}`);
    return;
  }
  
  const lowerMsg = message.toLowerCase();
  if (lowerMsg.includes('mammography')) lead.testType = 'Mammography';
  else if (lowerMsg.includes('dexa')) lead.testType = 'DEXA';
  else if (lowerMsg.includes('blood')) lead.testType = 'Blood Package';
  else if (!lead.name && message.length > 2) lead.name = message;
  
  await lead.save();
  
  if (lead.executivePhone) {
    await sendWatiText(lead.executivePhone, `📩 Patient ${phoneNumber}: "${message.substring(0, 80)}"\n\nChat: https://wa.me/${phoneNumber}`);
  }
}

// ==================== API Endpoints ====================
app.get('/api/leads', async (req, res) => {
  const leads = await Lead.find({ campaign: 'health_checkup' }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: leads });
});

app.get('/api/stats', async (req, res) => {
  const total = await Lead.countDocuments({ campaign: 'health_checkup' });
  const today = new Date(); today.setHours(0,0,0,0);
  const todayLeads = await Lead.countDocuments({ campaign: 'health_checkup', createdAt: { $gte: today } });
  const converted = await Lead.countDocuments({ campaign: 'health_checkup', status: 'converted' });
  const assigned = await Lead.countDocuments({ campaign: 'health_checkup', status: 'assigned' });
  
  const execStats = [];
  for (const exec of executives) {
    const count = await Lead.countDocuments({ campaign: 'health_checkup', executiveAssigned: exec.name });
    const conv = await Lead.countDocuments({ campaign: 'health_checkup', executiveAssigned: exec.name, status: 'converted' });
    execStats.push({ 
      name: exec.name, 
      phone: exec.phone, 
      totalLeads: count, 
      converted: conv, 
      conversionRate: count > 0 ? ((conv/count)*100).toFixed(1) : 0 
    });
  }
  
  res.json({ success: true, stats: { totalLeads: total, todayLeads, converted, assigned }, executiveStats: execStats });
});

app.put('/api/leads/:id', async (req, res) => {
  const lead = await Lead.findByIdAndUpdate(req.params.id, { status: req.body.status, updatedAt: new Date() }, { new: true });
  res.json({ success: true, data: lead });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 HEALTH CAMPAIGN SERVER STARTED');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook/wati`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log('='.repeat(60));
  console.log(`📌 WATI Configuration:`);
  console.log(`   Base URL: ${WATI_BASE_URL}`);
  console.log(`   API Key: ${WATI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   Lead Template: ${process.env.LEAD_TEMPLATE_NAME || 'campaign_women'}`);
  console.log(`   Executive Template: ${process.env.EXECUTIVE_TEMPLATE_NAME || 'new_lead_campaign'}`);
  console.log('='.repeat(60));
  console.log('👥 Executives (Round Robin):');
  executives.forEach((exec, i) => {
    console.log(`   ${i+1}. ${exec.name} - ${exec.phone}`);
  });
  console.log('='.repeat(60));
});
