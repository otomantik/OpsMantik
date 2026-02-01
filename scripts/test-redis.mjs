import { Redis } from '@upstash/redis'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

// Load .env.local
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

async function testRedis() {
    console.log('--- 🚀 UPSTASH REDIS CONNECTION TEST ---')

    if (!url || !token) {
        console.error('❌ ERROR: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing in .env.local')
        process.exit(1)
    }

    const redis = new Redis({
        url: url,
        token: token,
    })

    try {
        console.log('Connecting to Upstash...')

        // Test SET
        const testKey = 'opsmantik:test_connection'
        const testValue = `ok-${Date.now()}`
        await redis.set(testKey, testValue)
        console.log(`✅ SET successful: ${testKey} -> ${testValue}`)

        // Test GET
        const result = await redis.get(testKey)
        console.log(`✅ GET successful: Got ${result}`)

        // Test INCR (used in Rate Limiter)
        const incrKey = 'opsmantik:test_incr'
        const newVal = await redis.incr(incrKey)
        console.log(`✅ INCR successful: New value: ${newVal}`)

        // Test EXPIRE
        await redis.expire(incrKey, 10)
        console.log('✅ EXPIRE set for 10 seconds.')

        console.log('\n✨ ALL TESTS PASSED! UPSTASH REDIS IS READY.')
    } catch (error) {
        console.error('❌ REDIS TEST FAILED:')
        console.error(error)
        process.exit(1)
    }
}

testRedis()
