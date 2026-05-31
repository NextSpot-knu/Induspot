const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL || 'https://xdwnwrthrgflbzpvkouq.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Please run: node --env-file=.env.local scripts/seed_parking.js");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Simple CSV parser for quoted fields
function parseCSV(text) {
  let p = '', row = [''], ret = [row], i = 0, r = 0, s = !0, l;
  for (l of text) {
    if ('"' === l) {
      if (s && l === p) row[i] += l;
      s = !s;
    } else if (',' === l && s) l = row[++i] = '';
    else if ('\n' === l && s) {
      if ('\r' === p) row[i] = row[i].slice(0, -1);
      row = ret[++r] = [l = '']; i = 0;
    } else row[i] += l;
    p = l;
  }
  return ret.filter(r => r.length > 1 || r[0] !== '');
}

async function seedParking() {
  const csvPath = path.join(__dirname, '..', 'samples', 'gumi_parking_private.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found at ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(csvContent);
  
  // First row is header
  const headers = rows[0];
  const dataRows = rows.slice(1);

  const facilitiesToInsert = [];

  for (const row of dataRows) {
    if (row.length < headers.length) continue; // Skip empty or malformed rows

    // id,name,type,latitude,longitude,capacity,operating_hours,features,max_capacity_vehicles
    const name = row[1];
    const type = row[2];
    const latitude = parseFloat(row[3]);
    const longitude = parseFloat(row[4]);
    const capacity = parseInt(row[5], 10);
    
    let operating_hours = {};
    try {
      operating_hours = JSON.parse(row[6] || '{}');
    } catch (e) {
      console.warn(`Failed to parse operating_hours for ${name}`);
    }

    let features = {};
    try {
      features = JSON.parse(row[7] || '{}');
    } catch (e) {
      console.warn(`Failed to parse features for ${name}`);
    }

    const max_capacity_vehicles = parseInt(row[8], 10);
    if (!isNaN(max_capacity_vehicles)) {
      features.max_capacity_vehicles = max_capacity_vehicles;
    }

    facilitiesToInsert.push({
      name,
      type,
      latitude,
      longitude,
      capacity,
      operating_hours,
      features
    });
  }

  console.log('Deleting existing parking facilities to avoid duplicates...');
  const { error: deleteError } = await supabase
    .from('facilities')
    .delete()
    .eq('type', 'parking');

  if (deleteError) {
    console.error('Error deleting existing parking facilities:', deleteError);
    return;
  }

  console.log(`Parsed ${facilitiesToInsert.length} parking facilities. Inserting to Supabase...`);

  const { data, error } = await supabase
    .from('facilities')
    .insert(facilitiesToInsert)
    .select();

  if (error) {
    console.error('Error inserting parking facilities:', error);
  } else {
    console.log(`Successfully inserted ${data.length} parking facilities!`);
  }
}

seedParking();
