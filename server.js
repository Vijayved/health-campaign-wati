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
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ MongoDB Connected Successfully');
}).catch(err => {
  console.error('❌ MongoDB Connection Error:', err.message);
});

// ==================== Lead Schema ====================
const leadSchema = new mongoose.Schema({
  phoneNumber: String,
  name: String,
  branch: { type: String, default: 'Usmanpura' },
  testType: String,
  testDetails: String,
  executiveAssigned: String,
  executivePhone: String,
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

// ==================== WATI API Helper ====================
const WATI_BASE_URL = process.env.WATI_API_URL || 'https://live-mt-server.wati.io';
const WATI_API_KEY = process.env.WATI_API_KEY;

// Send WhatsApp Template Message
async function sendWatiTemplate(phoneNumber, templateName, params = [], buttons = []) {
  try {
    const url = `${WATI_BASE_URL}/api/v1/sendTemplateMessages?phone=${phoneNumber}`;
    
    const payload = {
      template_name: templateName,
      broadcast_name: `Health_Campaign_${Date.now()}`,
      parameters: params.map(p => ({ name: p.name, value: p.value }))
    };
    
    // Add quick reply buttons if provided
    if (buttons.length > 0) {
      payload.buttons = buttons.map(b => ({ type: 'quick_reply', text: b }));
    }
    
    console.log(`📤 Sending template to ${phoneNumber}: ${templateName}`);
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Template sent to ${phoneNumber}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send template to ${phoneNumber}:`);
    console.error('Error:', error.response?.data || error.message);
    return null;
  }
}

// Send Text Message
async function sendWatiText(phoneNumber, text) {
  try {
    const url = `${WATI_BASE_URL}/api/v1/sendSessionMessage/${phoneNumber}`;
    const payload = { text };
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Text sent to ${phoneNumber}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send text to ${phoneNumber}:`);
    console.error('Error:', error.response?.data || error.message);
    return null;
  }
}

// ==================== Webhook: WATI Incoming Message ====================
app.post('/webhook/wati', async (req, res) => {
  console.log('\n📨 ========== WATI WEBHOOK RECEIVED ==========');
  console.log('Full Data:', JSON.stringify(req.body, null, 2));
  
  try {
    const messageData = req.body;
    
    // Extract phone number
    let phoneNumber = messageData.phoneNumber || messageData.from || messageData.waId || messageData.sender;
    
    // Extract message text
    let message = messageData.text || messageData.message || messageData.body;
    
    // Extract Quick Reply button response
    let buttonResponse = null;
    
    // Check for quick reply button click
    if (messageData.interactive && messageData.interactive.type === 'button_reply') {
      buttonResponse = messageData.interactive.button_reply?.id || messageData.interactive.button_reply?.title;
      message = buttonResponse;
      console.log(`🔘 Quick Reply Button Clicked: ${buttonResponse}`);
    }
    
    // Check for simple button response in other formats
    if (messageData.buttonText) {
      buttonResponse = messageData.buttonText;
      message = buttonResponse;
      console.log(`🔘 Button Clicked: ${buttonResponse}`);
    }
    
    console.log(`📞 Phone: ${phoneNumber}`);
    console.log(`💬 Message: ${message}`);
    
    if (!phoneNumber) {
      console.log('⚠️ No phone number, sending OK');
      return res.status(200).send('OK');
    }
    
    // Clean phone number
    phoneNumber = phoneNumber.replace(/^\+91/, '').replace(/[^0-9]/g, '');
    console.log(`📱 Cleaned: ${phoneNumber}`);
    
    // Check if it's a Book Now response
    if (message && (message.toLowerCase() === 'book now' || 
                    message.toLowerCase().includes('book now') || 
                    message.toLowerCase() === 'book' ||
                    message.toLowerCase().includes('book karo'))) {
      await handleCampaignLead(phoneNumber, message);
    } else {
      await handlePatientReply(phoneNumber, message);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(200).send('OK');
  }
});

// Handle New Campaign Lead
async function handleCampaignLead(phoneNumber, message) {
  console.log('\n🎯 ========== NEW CAMPAIGN LEAD ==========');
  console.log(`Phone: ${phoneNumber}`);
  console.log(`Trigger: ${message}`);
  
  // Check if lead already exists
  const existingLead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  if (existingLead && existingLead.status !== 'new') {
    console.log(`⚠️ Lead exists: ${phoneNumber}, status: ${existingLead.status}`);
    return;
  }
  
  // Assign executive via round robin
  const executive = getNextExecutive();
  if (!executive) {
    console.log('❌ No active executives');
    return;
  }
  
  console.log(`👤 Assigned to: ${executive.name} (${executive.whatsapp})`);
  
  // Create lead
  const lead = new Lead({
    phoneNumber,
    branch: 'Usmanpura',
    executiveAssigned: executive.name,
    executivePhone: executive.whatsapp,
    status: 'assigned'
  });
  await lead.save();
  console.log(`✅ Lead saved: ${lead._id}`);
  
  // Send Health Campaign Template with Quick Reply Button
  const mammographyLink = process.env.MAMMOGRAPHY_LINK || 'https://www.nibib.nih.gov/sites/default/files/2022-05/Fact-Sheet-Mammography.pdf';
  const dexaLink = process.env.DEXA_LINK || 'https://www.youtube.com/watch?v=HkLuviUi8Mc';
  const bloodPackageLink = process.env.BLOOD_PACKAGE_LINK || 'https://www.airmedlabs.com/';
  const bookingLink = process.env.BOOKING_LINK || `https://wa.me/${phoneNumber}?text=I%20want%20to%20book`;
  
  const leadTemplate = process.env.LEAD_TEMPLATE_NAME || 'health_checkup_welcome';
  await sendWatiTemplate(phoneNumber, leadTemplate, [
    { name: '1', value: mammographyLink },
    { name: '2', value: dexaLink },
    { name: '3', value: bloodPackageLink },
    { name: '4', value: bookingLink }
  ], ['Book Now']);
  
  // Send Executive Notification
  const callLink = `tel:+91${executive.phone}`;
  const whatsappChatLink = `https://wa.me/${executive.whatsapp}?text=Hi%20${encodeURIComponent(executive.name)}%2C%20New%20lead%20from%20health%20campaign%3A%20${phoneNumber}`;
  const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  
  console.log(`📤 Sending notification to executive: ${executive.whatsapp}`);
  const execTemplate = process.env.EXECUTIVE_TEMPLATE_NAME || 'executive_lead_notification';
  await sendWatiTemplate(executive.whatsapp, execTemplate, [
    { name: '1', value: phoneNumber },
    { name: '2', value: callLink },
    { name: '3', value: whatsappChatLink },
    { name: '4', value: currentTime }
  ]);
  
  console.log(`✅ Lead processed for ${phoneNumber}`);
  executive.leadCount++;
}

// Handle Patient Replies
async function handlePatientReply(phoneNumber, message) {
  console.log(`💬 Reply from ${phoneNumber}: ${message}`);
  
  const lead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  if (!lead) {
    console.log(`⚠️ No lead for ${phoneNumber}`);
    return;
  }
  
  // Simple classification
  if (message.toLowerCase().includes('mammography')) {
    lead.testType = 'Mammography';
  } else if (message.toLowerCase().includes('dexa') || message.toLowerCase().includes('bone')) {
    lead.testType = 'DEXA';
  } else if (message.toLowerCase().includes('blood')) {
    lead.testType = 'Blood Package';
  } else if (message.length > 3 && !lead.testDetails) {
    lead.testDetails = message;
  }
  
  lead.updatedAt = new Date();
  await lead.save();
  
  // Notify executive
  const execPhone = lead.executivePhone;
  if (execPhone) {
    const replyMsg = `📩 Patient ${phoneNumber} replied: "${message.substring(0, 80)}"\n\n💬 Chat: https://wa.me/${phoneNumber}`;
    await sendWatiText(execPhone, replyMsg);
    console.log(`📤 Notified executive: ${execPhone}`);
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
    res.json({ success: true, data: leads });
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
  console.log('\n' + '='.repeat(50));
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook/wati`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log('='.repeat(50));
});
