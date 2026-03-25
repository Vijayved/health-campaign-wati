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

// ==================== MongoDB Models ====================
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Lead Schema
const leadSchema = new mongoose.Schema({
  phoneNumber: String,
  name: String,
  branch: String,
  testType: String,
  testDetails: String,
  executiveAssigned: String,
  executivePhone: String,
  status: {
    type: String,
    enum: ['new', 'assigned', 'converted', 'waiting', 'not_converted'],
    default: 'new'
  },
  source: String,
  campaign: String,
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

// Round Robin counter
let currentExecutiveIndex = 0;

// Get next executive (Round Robin)
function getNextExecutive() {
  const activeExecs = executives.filter(e => e.active);
  if (activeExecs.length === 0) return null;
  
  const exec = activeExecs[currentExecutiveIndex % activeExecs.length];
  currentExecutiveIndex++;
  return exec;
}

// ==================== WATI API Helper ====================
const watiApi = axios.create({
  baseURL: process.env.WATI_API_URL,
  headers: {
    'Authorization': `Bearer ${process.env.WATI_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

// Send WhatsApp Template
async function sendWatiTemplate(phoneNumber, templateName, params = []) {
  try {
    const payload = {
      template_name: templateName,
      broadcast_name: `Health_Campaign_${Date.now()}`,
      parameters: params.map(p => ({ name: p.name, value: p.value }))
    };
    
    const response = await watiApi.post(`/sendTemplateMessages?phone=${phoneNumber}`, payload);
    console.log(`✅ Template sent to ${phoneNumber}: ${templateName}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send template to ${phoneNumber}:`, error.response?.data || error.message);
    return null;
  }
}

// Send Text Message
async function sendWatiText(phoneNumber, text) {
  try {
    const payload = { text };
    const response = await watiApi.post(`/sendSessionMessage/${phoneNumber}`, payload);
    console.log(`✅ Text sent to ${phoneNumber}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send text to ${phoneNumber}:`, error.response?.data || error.message);
    return null;
  }
}

// ==================== Webhook: WATI Incoming Message ====================
app.post('/webhook/wati', async (req, res) => {
  console.log('📨 WATI Webhook Received:', JSON.stringify(req.body, null, 2));
  
  try {
    const messageData = req.body;
    const phoneNumber = messageData.phoneNumber || messageData.from;
    const message = messageData.text || messageData.message || '';
    
    if (!phoneNumber) {
      return res.status(200).send('OK');
    }
    
    // Check if it's a button click (Book Now)
    if (message.includes('Book Now') || message.includes('book karo') || message.includes('BOOK NOW')) {
      await handleCampaignLead(phoneNumber, message);
    } else {
      await handlePatientReply(phoneNumber, message);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('OK');
  }
});

// Handle New Campaign Lead
async function handleCampaignLead(phoneNumber, message) {
  console.log(`🎯 New Campaign Lead: ${phoneNumber}`);
  
  const existingLead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  if (existingLead && existingLead.status !== 'new') {
    console.log(`Lead already exists: ${phoneNumber}`);
    return;
  }
  
  const executive = getNextExecutive();
  if (!executive) {
    console.log('No active executives available');
    return;
  }
  
  const lead = new Lead({
    phoneNumber,
    branch: 'Usmanpura',
    source: 'WATI_Campaign',
    campaign: 'health_checkup',
    executiveAssigned: executive.name,
    executivePhone: executive.whatsapp,
    status: 'assigned'
  });
  await lead.save();
  
  // Send Health Campaign Template to Customer
  const mammographyLink = process.env.MAMMOGRAPHY_LINK || 'https://youtu.be/example';
  const dexaLink = process.env.DEXA_LINK || 'https://youtu.be/example';
  const bloodPackageLink = process.env.BLOOD_PACKAGE_LINK || 'https://drive.google.com/example';
  const bookingLink = process.env.BOOKING_LINK || 'https://wa.me/919876543210';
  
  await sendWatiTemplate(phoneNumber, 'health_checkup_welcome', [
    { name: '1', value: mammographyLink },
    { name: '2', value: dexaLink },
    { name: '3', value: bloodPackageLink },
    { name: '4', value: bookingLink }
  ]);
  
  // Send Executive Notification
  const callLink = `tel:+91${executive.phone}`;
  const whatsappChatLink = `https://wa.me/${executive.whatsapp}?text=Hi%20${executive.name}%2C%20New%20lead%20${phoneNumber}`;
  const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  
  await sendWatiTemplate(executive.whatsapp, 'executive_lead_notification', [
    { name: '1', value: phoneNumber },
    { name: '2', value: callLink },
    { name: '3', value: whatsappChatLink },
    { name: '4', value: currentTime }
  ]);
  
  console.log(`✅ Lead assigned to ${executive.name}`);
  executive.leadCount++;
}

// Handle Patient Replies
async function handlePatientReply(phoneNumber, message) {
  const lead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  if (!lead) return;
  
  if (message.includes('mammography') || message.includes('Mammography')) {
    lead.testType = 'Mammography';
  } else if (message.includes('DEXA') || message.includes('dexa')) {
    lead.testType = 'DEXA';
  } else if (message.includes('blood') || message.includes('Blood')) {
    lead.testType = 'Blood Package';
  } else if (lead.testType && !lead.testDetails && message.length > 3) {
    lead.testDetails = message;
  }
  
  lead.updatedAt = new Date();
  await lead.save();
  
  const execPhone = lead.executivePhone;
  if (execPhone) {
    await sendWatiText(execPhone, `📩 Patient ${phoneNumber} replied: "${message.substring(0, 50)}..."\n\n💬 Chat: https://wa.me/${phoneNumber}`);
  }
}

// ==================== API Endpoints ====================
app.get('/api/leads', async (req, res) => {
  try {
    const { status, executive, limit = 100 } = req.query;
    let filter = { campaign: 'health_checkup' };
    if (status) filter.status = status;
    if (executive) filter.executiveAssigned = executive;
    
    const leads = await Lead.find(filter).sort({ createdAt: -1 }).limit(parseInt(limit));
    const total = await Lead.countDocuments(filter);
    res.json({ success: true, data: leads, total });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const totalLeads = await Lead.countDocuments({ campaign: 'health_checkup' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLeads = await Lead.countDocuments({ campaign: 'health_checkup', createdAt: { $gte: today } });
    const converted = await Lead.countDocuments({ campaign: 'health_checkup', status: 'converted' });
    const waiting = await Lead.countDocuments({ campaign: 'health_checkup', status: 'waiting' });
    const notConverted = await Lead.countDocuments({ campaign: 'health_checkup', status: 'not_converted' });
    const assigned = await Lead.countDocuments({ campaign: 'health_checkup', status: 'assigned' });
    
    const executiveStats = [];
    for (const exec of executives) {
      const execLeads = await Lead.countDocuments({ campaign: 'health_checkup', executiveAssigned: exec.name });
      const execConverted = await Lead.countDocuments({ campaign: 'health_checkup', executiveAssigned: exec.name, status: 'converted' });
      executiveStats.push({
        name: exec.name,
        phone: exec.phone,
        totalLeads: execLeads,
        converted: execConverted,
        conversionRate: execLeads > 0 ? ((execConverted / execLeads) * 100).toFixed(1) : 0
      });
    }
    
    res.json({ success: true, stats: { totalLeads, todayLeads, converted, waiting, notConverted, assigned }, executiveStats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/leads/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const lead = await Lead.findByIdAndUpdate(req.params.id, { status, updatedAt: new Date() }, { new: true });
    res.json({ success: true, data: lead });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook/wati`);
});
