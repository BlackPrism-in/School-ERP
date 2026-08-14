import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ErrorPanel from './ErrorPanel.vue'
import { ApiError } from '../api/client'

describe('ErrorPanel', () => {
  it('shows the server message rather than a generic one', () => {
    const wrapper = mount(ErrorPanel, {
      props: { error: new ApiError(409, 'is_holiday', 'That day is a holiday (Founders Day).') },
    })
    expect(wrapper.text()).toContain('Founders Day')
  })

  /**
   * "Cannot reach the server" and "the server said no" call for different
   * actions from the user, so they must not look the same.
   */
  it('distinguishes offline from a rejection', () => {
    const offline = mount(ErrorPanel, {
      props: { error: new ApiError(0, 'network_error', 'Could not reach the server.') },
    })
    expect(offline.text()).toContain('Cannot reach the server')

    const rejected = mount(ErrorPanel, {
      props: { error: new ApiError(500, 'internal_error', 'Something went wrong.'), context: 'Could not load students' },
    })
    expect(rejected.text()).toContain('Could not load students')
    expect(rejected.text()).not.toContain('Cannot reach the server')
  })

  it('falls back to a safe message for a non-API error', () => {
    const wrapper = mount(ErrorPanel, { props: { error: new TypeError('x.y is not a function') } })
    expect(wrapper.text()).toContain('Something went wrong while loading this')
    // Internal detail must not leak into the UI.
    expect(wrapper.text()).not.toContain('is not a function')
  })

  it('emits retry so the caller can refetch', async () => {
    const wrapper = mount(ErrorPanel, { props: { error: new ApiError(500, 'x', 'boom') } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('announces itself to assistive technology', () => {
    const wrapper = mount(ErrorPanel, { props: { error: new ApiError(500, 'x', 'boom') } })
    expect(wrapper.attributes('role')).toBe('alert')
  })
})
