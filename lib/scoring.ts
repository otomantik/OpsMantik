/**
 * Lead Scoring Module
 * 
 * Computes lead score based on event category, action, and context.
 * Extracted from app/api/sync/route.ts for canonical single source of truth.
 */

export interface EventInput {
    event_category: string;
    event_action: string;
    event_value: number | null;
}

/**
 * Compute lead score based on event characteristics and context.
 * 
 * Scoring rules:
 * - Category: conversion (+50), interaction (+10)
 * - Deep engagement: scroll_depth >= 50 (+10), >= 90 (+20), hover_intent (+15)
 * - Context: google referrer (+5), returning ad user (+25)
 * - Cap: maximum 100
 * 
 * @param event - Event input (category, action, value)
 * @param referrer - Referrer URL string
 * @param isReturningAdUser - Whether user is a returning ad user (multi-touch attribution)
 * @returns Lead score (0-100)
 */
export function computeLeadScore(
    event: EventInput,
    referrer: string | null,
    isReturningAdUser: boolean
): number {
    let leadScore = 0;

    // A. Category Scoring
    if (event.event_category === 'conversion') leadScore += 50;
    if (event.event_category === 'interaction') leadScore += 10;

    // B. Deep Engagement Scoring
    if (event.event_action === 'scroll_depth') {
        const depth = Number(event.event_value);
        if (depth >= 50) leadScore += 10;
        if (depth >= 90) leadScore += 20;
    }

    if (event.event_action === 'hover_intent') leadScore += 15;

    // C. Context Scoring
    if (referrer?.includes('google')) leadScore += 5;
    if (isReturningAdUser) leadScore += 25; // Returning ad users are high intent

    // Cap Score
    leadScore = Math.min(leadScore, 100);

    return leadScore;
}
