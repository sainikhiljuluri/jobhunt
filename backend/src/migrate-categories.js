/**
 * Migration: re-categorize all existing jobs using the improved classifyCategory
 * Run once: node src/migrate-categories.js
 */
import { createClient } from '@supabase/supabase-js';
import { classifyCategory } from './utils/helpers.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function migrate() {
    const { data: jobs, error } = await supabase
        .from('jobs')
        .select('id, title, source');

    if (error) { console.error(error); process.exit(1); }

    const counts = {};
    for (const job of jobs) {
        const cat = classifyCategory(job.title, '');
        await supabase.from('jobs').update({ category: cat }).eq('id', job.id);
        counts[cat] = (counts[cat] || 0) + 1;
    }

    console.log(`✅ Re-categorized ${jobs.length} jobs:`);
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([cat, n]) => console.log(`   ${cat.padEnd(15)} ${n}`));
}

migrate().catch(console.error);
