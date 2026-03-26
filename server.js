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
  assignedCount: { type: Number, default: 0 },
  lastAssignedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Lead = mongoose.model('Lead', leadSchema);

// ==================== Executive Configuration ====================
const executives = [
  { name: 'Aditi', phone: '8488931212', whatsapp: '8488931212', active: true, totalAssigned: 0 },
  { name: 'Khyati', phone: '7490029085', whatsapp: '7490029085', active: true, totalAssigned: 0 },
  { name: 'Jay', phone: '9274682553', whatsapp: '9274682553', active: true, totalAssigned: 0 },
  { name: 'Mital', phone: '9558591212', whatsapp: '9558591212', active: true, totalAssigned: 0 }
];

let currentRoundRobinIndex = 0;

function getNextExecutive() {
  const activeExecs = executives.filter(e => e.active);
  if (activeExecs.length === 0) return null;
  const exec = activeExecs[currentRoundRobinIndex % activeExecs.length];
  currentRoundRobinIndex++;
  return exec;
}

function getDifferentExecutive(currentName) {
  const otherExecs = executives.filter(e => e.active && e.name !== currentName);
  if (otherExecs.length === 0) return executives.find(e => e.name === currentName);
  return otherExecs.reduce((min, exec) => 
    exec.totalAssigned < min.totalAssigned ? exec : min, otherExecs[0]);
}

// ==================== Phone Number Normalization ====================
function normalizePhone(number) {
  if (!number) return '';
  let digits = String(number).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length > 12) return digits.slice(-12);
  return digits;
}

// ==================== WATI API Configuration ====================
const WATI_BASE_URL = process.env.WATI_API_URL || 'https://live-mt-server.wati.io/1110';
const WATI_API_KEY = process.env.WATI_API_KEY;

// ============================================
// ✅ CORRECTED: Send WhatsApp Template Message
// ============================================
async function sendWatiTemplateMessage(whatsappNumber, templateName, parameters) {
  try {
    const cleanNumber = normalizePhone(whatsappNumber);
    console.log(`\n📤 Sending template ${templateName} to ${cleanNumber}`);
    
    // ✅ CORRECT URL - as per working reference
    const url = `${WATI_BASE_URL}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(cleanNumber)}`;
    
    // ✅ CORRECT PAYLOAD
    const payload = {
      template_name: templateName,
      broadcast_name: `Health_Campaign_${Date.now()}`,
      parameters: parameters || []
    };
    
    console.log(`   URL: ${url}`);
    console.log(`   Payload:`, JSON.stringify(payload, null, 2));
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    
    console.log(`✅ Template ${templateName} sent successfully to ${cleanNumber}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Template failed for ${whatsappNumber}:`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`   Error: ${error.message}`);
    }
    return null;
  }
}

// ============================================
// ✅ CORRECTED: Send Text Message (Session Message)
// ============================================
async function sendWatiTextMessage(whatsappNumber, text) {
  try {
    const cleanNumber = normalizePhone(whatsappNumber);
    console.log(`\n📤 Sending text to ${cleanNumber}`);
    
    // ✅ CORRECT URL
    const url = `${WATI_BASE_URL}/api/v1/sendSessionMessage/${cleanNumber}`;
    
    // ✅ CORRECT PAYLOAD - messageText, NOT text
    const payload = { messageText: text };
    
    const response = await axios.post(url, payload, {
      headers: { 
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Text sent to ${cleanNumber}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Text failed for ${whatsappNumber}:`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`   Error: ${error.message}`);
    }
    return null;
  }
}

// ============================================
// ✅ WATI WEBHOOK - यहाँ WATI से Data आता है
// ============================================
app.post('/webhook/wati', async (req, res) => {
  try {
    console.log('\n📨 ========== WATI WEBHOOK RECEIVED ==========');
    console.log('Time:', new Date().toISOString());
    
    const msg = req.body;
    console.log('Full Data:', JSON.stringify(msg, null, 2));
    
    // Sender का WhatsApp Number
    let senderNumber = msg.whatsappNumber || msg.from || msg.waId || msg.phoneNumber;
    
    // Message का Text
    let messageText = '';
    if (msg.text) messageText = msg.text;
    else if (msg.body) messageText = msg.body;
    else if (msg.listReply) messageText = msg.listReply.title;
    else if (msg.buttonReply) messageText = msg.buttonReply.text || msg.buttonReply.title;
    else if (msg.interactiveButtonReply) messageText = msg.interactiveButtonReply.title;
    
    console.log(`📞 From: ${senderNumber}`);
    console.log(`💬 Message: "${messageText}"`);
    
    if (!senderNumber) {
      console.log('⚠️ No sender number found');
      return res.status(200).send('OK');
    }
    
    // Normalize phone number
    const cleanNumber = normalizePhone(senderNumber);
    console.log(`📱 Normalized: ${cleanNumber}`);
    
    // Check if it's Book Now
    const isBookNow = messageText && (
      messageText.toLowerCase() === 'book now' || 
      messageText.toLowerCase().includes('book now') ||
      messageText.toLowerCase() === 'book'
    );
    
    if (isBookNow) {
      console.log('🎯 Book Now detected - Processing lead');
      await handleCampaignLead(cleanNumber);
    } else if (messageText && messageText.trim().length > 0) {
      console.log('💬 Patient reply detected');
      await handlePatientReply(cleanNumber, messageText);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(200).send('OK');
  }
});

// ============================================
// ✅ Handle Campaign Lead
// ============================================
async function handleCampaignLead(phoneNumber) {
  console.log('\n🎯 ========== CAMPAIGN LEAD ==========');
  console.log(`📱 Phone: ${phoneNumber}`);
  
  const existingLead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  
  let executive;
  let isNewLead = false;
  let reminderCount = 0;
  
  if (existingLead) {
    reminderCount = existingLead.assignedCount + 1;
    console.log(`⚠️ Existing lead - Previous: ${existingLead.executiveAssigned}`);
    console.log(`   Times assigned: ${existingLead.assignedCount}`);
    
    executive = getDifferentExecutive(existingLead.executiveAssigned);
    console.log(`🔄 Re-assigning to: ${executive.name}`);
    
    existingLead.executiveAssigned = executive.name;
    existingLead.executivePhone = executive.whatsapp;
    existingLead.assignedCount += 1;
    existingLead.lastAssignedAt = new Date();
    existingLead.status = 'assigned';
    await existingLead.save();
    console.log(`✅ Lead updated`);
    
  } else {
    executive = getNextExecutive();
    if (!executive) {
      console.log('❌ No executives available!');
      return;
    }
    isNewLead = true;
    console.log(`✨ New lead - Assigning: ${executive.name}`);
    
    const lead = new Lead({
      phoneNumber,
      executiveAssigned: executive.name,
      executivePhone: executive.whatsapp,
      status: 'assigned',
      assignedCount: 1,
      lastAssignedAt: new Date()
    });
    await lead.save();
    console.log(`✅ New lead saved`);
  }
  
  executive.totalAssigned += 1;
  console.log(`📊 ${executive.name} total: ${executive.totalAssigned}`);
  
  // Get links from environment variables
  const mammographyLink = process.env.MAMMOGRAPHY_LINK || 'https://www.nibib.nih.gov/sites/default/files/2022-05/Fact-Sheet-Mammography.pdf';
  const dexaLink = process.env.DEXA_LINK || 'https://www.youtube.com/watch?v=HkLuviUi8Mc';
  const bloodPackageLink = process.env.BLOOD_PACKAGE_LINK || 'https://www.airmedlabs.com/';
  const bookingLink = process.env.BOOKING_LINK || `https://wa.me/${phoneNumber}?text=I%20want%20to%20book%20a%20test`;
  
  console.log(`\n📌 LINKS (Parameters):`);
  console.log(`   {{1}} = ${mammographyLink}`);
  console.log(`   {{2}} = ${dexaLink}`);
  console.log(`   {{3}} = ${bloodPackageLink}`);
  console.log(`   {{4}} = ${bookingLink}`);
  
  const leadTemplate = 'campaign_women';
  const execTemplate = 'new_lead_campaign';
  
  // Parameters array for customer template
  const leadParameters = [
    { name: "1", value: mammographyLink },
    { name: "2", value: dexaLink },
    { name: "3", value: bloodPackageLink },
    { name: "4", value: bookingLink }
  ];
  
  // Send to customer
  if (isNewLead) {
    console.log(`\n📤 Sending WELCOME template to customer: ${leadTemplate}`);
    await sendWatiTemplateMessage(phoneNumber, leadTemplate, leadParameters);
  } else {
    console.log(`\n📤 Sending REMINDER text to customer:`);
    await sendWatiTextMessage(phoneNumber, `👋 Thank you for your interest! Our executive ${executive.name} will assist you shortly.\n\n📞 Chat: https://wa.me/${executive.whatsapp}`);
  }
  
  // Parameters array for executive template
  const callLink = `tel:+91${executive.phone}`;
  const whatsappChatLink = `https://wa.me/${executive.whatsapp}?text=Hi%20${encodeURIComponent(executive.name)}%2C%20Lead%20${phoneNumber}`;
  const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const leadType = isNewLead ? 'NEW' : `RETURN #${reminderCount}`;
  
  const execParameters = [
    { name: "1", value: `${phoneNumber} - ${leadType}` },
    { name: "2", value: callLink },
    { name: "3", value: whatsappChatLink },
    { name: "4", value: currentTime }
  ];
  
  // Send to executive
  console.log(`\n📤 Sending NOTIFICATION to executive: ${executive.whatsapp}`);
  await sendWatiTemplateMessage(executive.whatsapp, execTemplate, execParameters);
  
  console.log(`\n✅ Complete! Executive: ${executive.name} | Type: ${leadType}`);
}

// ============================================
// ✅ Handle Patient Replies
// ============================================
async function handlePatientReply(phoneNumber, message) {
  const lead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  if (!lead) {
    console.log(`⚠️ No lead found for ${phoneNumber}`);
    return;
  }
  
  console.log(`💬 Patient reply: ${message}`);
  
  const msgLower = message.toLowerCase();
  if (msgLower.includes('mammography')) lead.testType = 'Mammography';
  else if (msgLower.includes('dexa')) lead.testType = 'DEXA';
  else if (msgLower.includes('blood')) lead.testType = 'Blood Package';
  else if (!lead.name && message.length > 2) lead.name = message;
  
  await lead.save();
  console.log(`✅ Lead updated`);
  
  if (lead.executivePhone) {
    console.log(`📤 Notifying executive: ${lead.executivePhone}`);
    await sendWatiTextMessage(lead.executivePhone, `📩 Patient ${phoneNumber} replied: "${message.substring(0, 80)}"\n\nChat: https://wa.me/${phoneNumber}`);
  }
}

// ==================== API Endpoints ====================
app.get('/api/leads', async (req, res) => {
  try {
    const leads = await Lead.find({ campaign: 'health_checkup' }).sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, data: leads });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
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
        totalAssigned: exec.totalAssigned,
        converted: conv, 
        conversionRate: count > 0 ? ((conv/count)*100).toFixed(1) : 0 
      });
    }
    
    res.json({ success: true, stats: { totalLeads: total, todayLeads, converted, assigned }, executiveStats: execStats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/leads/:id', async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, { status: req.body.status, updatedAt: new Date() }, { new: true });
    res.json({ success: true, data: lead });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/executives/reset', async (req, res) => {
  executives.forEach(exec => exec.totalAssigned = 0);
  currentRoundRobinIndex = 0;
  res.json({ success: true, message: 'Executive counters reset' });
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

// ==================== Start Server ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 HEALTH CAMPAIGN SERVER STARTED');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook/wati`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  console.log('='.repeat(60));
  console.log('📌 WATI CONFIGURATION:');
  console.log(`   Base URL: ${WATI_BASE_URL}`);
  console.log(`   API Key: ${WATI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   Lead Template: campaign_women`);
  console.log(`   Executive Template: new_lead_campaign`);
  console.log('='.repeat(60));
  console.log('📌 PARAMETERS (Template Variables):');
  console.log(`   {{1}} = MAMMOGRAPHY_LINK: ${process.env.MAMMOGRAPHY_LINK || 'Not set'}`);
  console.log(`   {{2}} = DEXA_LINK: ${process.env.DEXA_LINK || 'Not set'}`);
  console.log(`   {{3}} = BLOOD_PACKAGE_LINK: ${process.env.BLOOD_PACKAGE_LINK || 'Not set'}`);
  console.log(`   {{4}} = BOOKING_LINK: ${process.env.BOOKING_LINK || 'Not set'}`);
  console.log('='.repeat(60));
  console.log('👥 EXECUTIVES (Round Robin):');
  executives.forEach((exec, i) => {
    console.log(`   ${i+1}. ${exec.name} - ${exec.phone}`);
  });
  console.log('='.repeat(60));
  console.log('📋 ROUND ROBIN RULES:');
  console.log('   • New customer → Next executive (Round Robin)');
  console.log('   • Existing customer → Different executive (Least loaded)');
  console.log('='.repeat(60));
});
