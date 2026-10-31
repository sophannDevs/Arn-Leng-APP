import { idSchema } from '@inkline/shared';
import { apiError, authorizeApi } from '@/server/auth/api';
import { hideComment } from '@/server/engagement/comments';

/** POST: hide a comment. Admins can hide any; a creator can hide comments on their own series. */
export async function POST(_request: Request, context: { params: Promise<{ commentId: string }> }) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  const id = idSchema.safeParse((await context.params).commentId);
  if (!id.success) return apiError(400, 'invalid_request');
  const result = await hideComment(id.data, { id: auth.user.id, role: auth.user.role });
  if (result === 'not_found') return apiError(404, 'not_found');
  if (result === 'forbidden') return apiError(403, 'forbidden');
  return new Response(null, { status: 204 });
}
