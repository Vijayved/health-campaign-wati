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

// ==================== WATI API Configuration ====================
const WATI_BASE_URL = process.env.WATI_API_URL || 'https://live-mt-server.wati.io/1110';
const WATI_API_KEY = process.env.WATI_API_KEY;

// Send WhatsApp Template Message - CORRECT FORMAT
async function sendWatiTemplate(phoneNumber, templateName, params = []) {
  try {
    let cleanPhone = phoneNumber.replace(/^\+91/, '').replace(/[^0-9]/g, '');
    const url = `${WATI_BASE_URL}/api/v1/sendTemplateMessages`;
    
    // IMPORTANT: WATI expects parameters as array with name and value
    const parameters = params.map(p => ({
      name: p.name,
      value: p.value
    }));
    
    const payload = {
      template_name: templateName,
      broadcast_name: `Health_Campaign_${Date.now()}`,
      receivers: [cleanPhone],
      parameters: parameters
    };
    
    console.log(`\n📤 SENDING TEMPLATE:`);
    console.log(`   URL: ${url}`);
    console.log(`   Template: ${templateName}`);
    console.log(`   Phone: ${cleanPhone}`);
    console.log(`   Params:`, JSON.stringify(parameters, null, 2));
    console.log(`   Full Payload:`, JSON.stringify(payload, null, 2));
    
    const response = await axios.post(url, payload, {
      headers: { 
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Template sent successfully to ${cleanPhone}`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error(`❌ Template failed for ${phoneNumber}:`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`   Error: ${error.message}`);
    }
    return null;
  }
}

// Send Text Message
async function sendWatiText(phoneNumber, text) {
  try {
    let cleanPhone = phoneNumber.replace(/^\+91/, '').replace(/[^0-9]/g, '');
    const url = `${WATI_BASE_URL}/api/v1/sendSessionMessage/${cleanPhone}`;
    const payload = { text };
    
    const response = await axios.post(url, payload, {
      headers: { 
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Text sent to ${cleanPhone}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Text failed:`, error.response?.data || error.message);
    return null;
  }
}

// ==================== Webhook ====================
app.post('/webhook/wati', async (req, res) => {
  console.log('\n' + '='.repeat(60));
  console.log('📨 WATI WEBHOOK RECEIVED');
  console.log('='.repeat(60));
  console.log('Time:', new Date().toISOString());
  console.log('Full Body:', JSON.stringify(req.body, null, 2));
  
  try {
    const data = req.body;
    
    let phoneNumber = data.waId || data.phoneNumber || data.from || data.sender;
    let message = data.text || data.message || data.body;
    
    if (data.buttonReply?.text) message = data.buttonReply.text;
    if (data.interactiveButtonReply?.title) message = data.interactiveButtonReply.title;
    
    console.log(`\n📞 Phone: ${phoneNumber}`);
    console.log(`💬 Message: ${message}`);
    
    if (!phoneNumber) {
      console.log('⚠️ No phone number');
      return res.status(200).send('OK');
    }
    
    phoneNumber = phoneNumber.replace(/^\+91/, '').replace(/[^0-9]/g, '');
    console.log(`📱 Cleaned: ${phoneNumber}`);
    
    const isBookNow = message && (
      message.toLowerCase() === 'book now' || 
      message.toLowerCase().includes('book now') ||
      message.toLowerCase() === 'book'
    );
    
    if (isBookNow) {
      await handleCampaignLead(phoneNumber);
    } else if (message && message.trim().length > 0) {
      await handlePatientReply(phoneNumber, message);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('OK');
  }
});

// Handle Campaign Lead
async function handleCampaignLead(phoneNumber) {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 CAMPAIGN LEAD HANDLER');
  console.log('='.repeat(60));
  console.log(`📱 Phone: ${phoneNumber}`);
  
  const existingLead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  
  let executive;
  let isNewLead = false;
  
  if (existingLead) {
    console.log(`⚠️ Existing lead - Previous: ${existingLead.executiveAssigned}`);
    executive = getDifferentExecutive(existingLead.executiveAssigned);
    console.log(`🔄 Re-assigning to: ${executive.name}`);
    
    existingLead.executiveAssigned = executive.name;
    existingLead.executivePhone = executive.whatsapp;
    existingLead.assignedCount += 1;
    existingLead.lastAssignedAt = new Date();
    existingLead.status = 'assigned';
    await existingLead.save();
    
  } else {
    executive = getNextExecutive();
    if (!executive) return console.log('❌ No executives');
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
  }
  
  executive.totalAssigned += 1;
  
  // Get links from environment variables
  const mammographyLink = process.env.MAMMOGRAPHY_LINK || 'https://www.nibib.nih.gov/sites/default/files/2022-05/Fact-Sheet-Mammography.pdf';
  const dexaLink = process.env.DEXA_LINK || 'https://www.youtube.com/watch?v=HkLuviUi8Mc';
  const bloodPackageLink = process.env.BLOOD_PACKAGE_LINK || 'https://www.airmedlabs.com/';
  const bookingLink = process.env.BOOKING_LINK || `https://wa.me/${phoneNumber}?text=I%20want%20to%20book%20a%20test`;
  
  console.log(`\n📌 Links being sent:`);
  console.log(`   {{1}} (Mammography): ${mammographyLink}`);
  console.log(`   {{2}} (DEXA): ${dexaLink}`);
  console.log(`   {{3}} (Blood Package): ${bloodPackageLink}`);
  console.log(`   {{4}} (Book Now): ${bookingLink}`);
  
  const leadTemplate = 'campaign_women';
  const execTemplate = 'new_lead_campaign';
  
  // Send to customer (always send template for new leads, reminder text for existing)
  if (isNewLead) {
    console.log(`\n📤 Sending TEMPLATE to customer: ${leadTemplate}`);
    await sendWatiTemplate(phoneNumber, leadTemplate, [
      { name: '1', value: mammographyLink },
      { name: '2', value: dexaLink },
      { name: '3', value: bloodPackageLink },
      { name: '4', value: bookingLink }
    ]);
  } else {
    console.log(`\n📤 Sending REMINDER text to customer:`);
    await sendWatiText(phoneNumber, `👋 Thank you for your interest! Our executive ${executive.name} will assist you shortly.\n\n📞 Chat: https://wa.me/${executive.whatsapp}`);
  }
  
  // Send to executive
  console.log(`\n📤 Sending NOTIFICATION to executive: ${executive.whatsapp}`);
  const callLink = `tel:+91${executive.phone}`;
  const whatsappChatLink = `https://wa.me/${executive.whatsapp}?text=Hi%20${encodeURIComponent(executive.name)}%2C%20Lead%20${phoneNumber}`;
  const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const leadType = isNewLead ? 'NEW' : `RETURN (${existingLead?.assignedCount || 1})`;
  
  await sendWatiTemplate(executive.whatsapp, execTemplate, [
    { name: '1', value: `${phoneNumber} - ${leadType}` },
    { name: '2', value: callLink },
    { name: '3', value: whatsappChatLink },
    { name: '4', value: currentTime }
  ]);
  
  console.log(`\n✅ Complete! Executive: ${executive.name} | Type: ${leadType}`);
}

// Handle Patient Replies
async function handlePatientReply(phoneNumber, message) {
  const lead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  if (!lead) {
    console.log(`⚠️ No lead for ${phoneNumber}`);
    return;
  }
  
  console.log(`💬 Reply: ${message}`);
  
  const msgLower = message.toLowerCase();
  if (msgLower.includes('mammography')) lead.testType = 'Mammography';
  else if (msgLower.includes('dexa')) lead.testType = 'DEXA';
  else if (msgLower.includes('blood')) lead.testType = 'Blood Package';
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
      totalAssigned: exec.totalAssigned,
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

app.post('/api/executives/reset', async (req, res) => {
  executives.forEach(exec => exec.totalAssigned = 0);
  currentRoundRobinIndex = 0;
  res.json({ success: true });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 SERVER STARTED');
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Webhook: http://localhost:${PORT}/webhook/wati`);
  console.log('='.repeat(60));
  console.log(`📌 Template: campaign_women (Customer)`);
  console.log(`   {{1}} = MAMMOGRAPHY_LINK: ${process.env.MAMMOGRAPHY_LINK}`);
  console.log(`   {{2}} = DEXA_LINK: ${process.env.DEXA_LINK}`);
  console.log(`   {{3}} = BLOOD_PACKAGE_LINK: ${process.env.BLOOD_PACKAGE_LINK}`);
  console.log(`   {{4}} = BOOKING_LINK: ${process.env.BOOKING_LINK}`);
  console.log('='.repeat(60));
  console.log(`📌 Template: new_lead_campaign (Executive)`);
  console.log('='.repeat(60));
});
