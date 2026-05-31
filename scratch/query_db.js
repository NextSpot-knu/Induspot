const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from('facilities').select('id, name, type, features');
  if (error) {
    console.error(error);
    return;
  }
  const parkingLots = data.filter(f => f.type === 'parking');
  console.log(`Total facilities: ${data.length}`);
  console.log(`Total parking lots: ${parkingLots.length}`);
  console.log("Sample parking lots (first 5):");
  console.log(parkingLots.slice(0, 5));
  
  const publicCount = parkingLots.filter(p => p.features?.is_public === true || p.features?.is_private === false || !p.features?.is_private).length;
  const privateCount = parkingLots.filter(p => p.features?.is_private === true || p.features?.parking_type === '사내').length;
  console.log(`Public parking lots: ${publicCount}`);
  console.log(`Private parking lots: ${privateCount}`);
}

run();
